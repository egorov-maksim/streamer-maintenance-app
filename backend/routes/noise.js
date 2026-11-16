// routes/noise.js
const express = require("express");
const { runAsync, getAllCamelized, getOneCamelized, execAtomic, sqlLiteral } = require("../db");
const { sendError } = require("../utils/errors");
const { requireValidId } = require("../utils/validation");
const { MEASURED_AT_SQL, parseRecordedAt, withMeasuredAt } = require("../utils/noiseUploadTime");

/**
 * Restrict RMS upload mutations to vessel-scoped accounts so global users
 * cannot rename or delete batches outside a vessel context.
 *
 * @param {Object} req - Express request with req.vesselScope
 * @param {Object} res - Express response
 * @returns {boolean} True when the request is vessel-scoped and may proceed
 */
function requireVesselScopedAccount(req, res) {
  if (!req.vesselScope) {
    sendError(res, 403, "Noise upload changes require a vessel-scoped account");
    return false;
  }
  return true;
}

/**
 * Load a noise upload only when it belongs to the authenticated vessel scope.
 *
 * @param {number} uploadId - Noise upload batch id
 * @param {string} vesselScope - Current user's vessel scope
 * @returns {Promise<Object|null>}
 */
function getScopedUpload(uploadId, vesselScope) {
  return getOneCamelized(
    "SELECT * FROM noise_uploads WHERE id = ? AND vessel_tag = ?",
    [uploadId, vesselScope]
  );
}

/**
 * Flattens and validates the { cable: { section: rms } } upload payload before anything
 * is written, so a bad cell can never leave a half-written batch behind.
 * Zero, empty and null cells mean "section not deployed" and are skipped.
 *
 * @param {Object} noiseData
 * @returns {{ rows: Array<[number, number, number]> } | { error: string }}
 */
function flattenNoisePayload(noiseData) {
  const rows = [];
  for (const [cableKey, sections] of Object.entries(noiseData)) {
    const cableNumber = Number(cableKey);
    if (!Number.isInteger(cableNumber) || cableNumber < 1) {
      return { error: `Invalid cable number "${cableKey}"` };
    }
    if (!sections || typeof sections !== "object") {
      return { error: `Sections for cable ${cableNumber} must be an object` };
    }
    for (const [sectionKey, rawValue] of Object.entries(sections)) {
      const sectionNumber = Number(sectionKey);
      if (!Number.isInteger(sectionNumber) || sectionNumber < 1) {
        return { error: `Invalid section number "${sectionKey}" for cable ${cableNumber}` };
      }
      if (rawValue === null || rawValue === undefined || rawValue === "") continue;
      const rms = typeof rawValue === "number" ? rawValue : typeof rawValue === "string" ? Number(rawValue) : NaN;
      if (!Number.isFinite(rms)) {
        return { error: `RMS value for cable ${cableNumber} section ${sectionNumber} must be a number` };
      }
      if (rms <= 0) continue;
      rows.push([cableNumber, sectionNumber, rms]);
    }
  }
  return { rows };
}

/** Rows per INSERT statement inside the atomic script (keeps each statement a sane size). */
const NOISE_INSERT_CHUNK = 500;

/**
 * Create noise data router (upload RMS batch, fetch by upload ID, list batches).
 * All noise data is scoped to a specific project.
 * @param {function} authMiddleware
 * @param {function} adminOrAbove
 * @returns {express.Router}
 */
function createNoiseRouter(authMiddleware, adminOrAbove) {
  const router = express.Router();

  // List all upload batches for a project, newest measurement first
  router.get("/api/noise-data/uploads", authMiddleware, async (req, res) => {
    try {
      const { project } = req.query;
      if (!project) {
        return res.json([]);
      }

      const conditions = ["project_number = ?"];
      const params = [project];

      if (req.vesselScope) {
        conditions.push("vessel_tag = ?");
        params.push(req.vesselScope);
      }

      const sql = `SELECT * FROM noise_uploads WHERE ${conditions.join(" AND ")} ORDER BY ${MEASURED_AT_SQL} DESC, id DESC`;
      const rows = await getAllCamelized(sql, params);
      res.json(rows.map(withMeasuredAt));
    } catch (err) {
      console.error("GET /api/noise-data/uploads failed", err);
      sendError(res, 500, "Failed to fetch noise uploads");
    }
  });

  // Get noise measurements for a specific upload (defaults to latest for the project)
  router.get("/api/noise-data", authMiddleware, async (req, res) => {
    try {
      const { project, uploadId } = req.query;

      if (!project && !uploadId) {
        return res.json({ uploadId: null, uploadedAt: null, label: null, noiseData: null });
      }

      let uploadRow;
      if (uploadId) {
        const conditions = ["id = ?"];
        const params = [uploadId];
        if (project) {
          conditions.push("project_number = ?");
          params.push(project);
        }
        if (req.vesselScope) {
          conditions.push("vessel_tag = ?");
          params.push(req.vesselScope);
        }
        uploadRow = await getOneCamelized(
          `SELECT * FROM noise_uploads WHERE ${conditions.join(" AND ")}`,
          params
        );
      } else {
        // Fetch latest for the given project
        const conditions = ["project_number = ?"];
        const params = [project];
        if (req.vesselScope) {
          conditions.push("vessel_tag = ?");
          params.push(req.vesselScope);
        }
        uploadRow = await getOneCamelized(
          `SELECT * FROM noise_uploads WHERE ${conditions.join(" AND ")} ORDER BY ${MEASURED_AT_SQL} DESC, id DESC LIMIT 1`,
          params
        );
      }

      if (!uploadRow) {
        return res.json({ uploadId: null, uploadedAt: null, label: null, noiseData: null });
      }

      const dataRows = await getAllCamelized(
        "SELECT cable_number, section_number, rms_value FROM noise_data WHERE upload_id = ?",
        [uploadRow.id]
      );

      // Build { [cableNum]: number[] } where index = sectionNumber - 1 (0-based)
      const noiseData = {};
      for (const row of dataRows) {
        const cableKey = String(row.cableNumber);
        if (!noiseData[cableKey]) noiseData[cableKey] = [];
        noiseData[cableKey][row.sectionNumber - 1] = row.rmsValue;
      }

      const timed = withMeasuredAt(uploadRow);
      res.json({
        uploadId: uploadRow.id,
        uploadedAt: uploadRow.uploadedAt,
        recordedAt: timed.recordedAt,
        measuredAt: timed.measuredAt,
        label: uploadRow.label,
        noiseData,
      });
    } catch (err) {
      console.error("GET /api/noise-data failed", err);
      sendError(res, 500, "Failed to fetch noise data");
    }
  });

  // Upload a new RMS noise batch (admin and above), scoped to a project
  router.post("/api/noise-data", authMiddleware, adminOrAbove, async (req, res) => {
    try {
      const { projectNumber, label, noiseData, waterSpeedStart, waterSpeedEnd, recordedAt } = req.body;

      if (!projectNumber) {
        return sendError(res, 400, "projectNumber is required");
      }
      if (!noiseData || typeof noiseData !== "object") {
        return sendError(res, 400, "noiseData object is required");
      }

      const flattened = flattenNoisePayload(noiseData);
      if (flattened.error) {
        return sendError(res, 400, flattened.error);
      }

      const speedStart = waterSpeedStart != null ? parseFloat(waterSpeedStart) : null;
      const speedEnd = waterSpeedEnd != null ? parseFloat(waterSpeedEnd) : null;

      if (speedStart !== null && isNaN(speedStart)) {
        return sendError(res, 400, "waterSpeedStart must be a number");
      }
      if (speedEnd !== null && isNaN(speedEnd)) {
        return sendError(res, 400, "waterSpeedEnd must be a number");
      }

      // Optional sequence time; when missing the upload time stands in for it.
      const recorded = parseRecordedAt(recordedAt);
      if (recorded.error) {
        return sendError(res, 400, recorded.error);
      }

      // Look up the project to get vessel_tag for the denormalized field + scope check
      const project = await getOneCamelized(
        "SELECT vessel_tag FROM projects WHERE project_number = ?",
        [projectNumber]
      );
      if (!project) {
        return sendError(res, 404, `Project ${projectNumber} not found`);
      }

      // Vessel-scoped users can only upload for their own vessel's projects
      if (req.vesselScope && project.vesselTag !== req.vesselScope) {
        return sendError(res, 403, "Project does not belong to your vessel");
      }

      // Insert the batch header (payload is already fully validated above).
      const headerResult = await runAsync(
        "INSERT INTO noise_uploads (project_number, vessel_tag, label, water_speed_start, water_speed_end, recorded_at) VALUES (?, ?, ?, ?, ?, ?)",
        [projectNumber, project.vesselTag, label || null, speedStart, speedEnd, recorded.value]
      );
      const uploadId = headerResult.lastID;

      // All measurements go in as ONE atomic script so no other request's statement
      // can interleave with (and be rolled back by) this transaction.
      try {
        const statements = [];
        for (let i = 0; i < flattened.rows.length; i += NOISE_INSERT_CHUNK) {
          const values = flattened.rows
            .slice(i, i + NOISE_INSERT_CHUNK)
            .map(([cable, section, rms]) =>
              `(${sqlLiteral(uploadId)}, ${sqlLiteral(cable)}, ${sqlLiteral(section)}, ${sqlLiteral(rms)})`)
            .join(",\n");
          statements.push(`INSERT INTO noise_data (upload_id, cable_number, section_number, rms_value) VALUES ${values}`);
        }
        if (statements.length > 0) {
          await execAtomic(statements);
        }
      } catch (insertErr) {
        // Never leave an empty batch header behind (it would become the "latest upload").
        await runAsync("DELETE FROM noise_uploads WHERE id = ?", [uploadId]).catch(() => {});
        throw insertErr;
      }

      const upload = await getOneCamelized(
        "SELECT * FROM noise_uploads WHERE id = ?",
        [uploadId]
      );

      const timed = withMeasuredAt(upload);
      res.status(201).json({
        uploadId: upload.id,
        uploadedAt: upload.uploadedAt,
        recordedAt: timed.recordedAt,
        measuredAt: timed.measuredAt,
      });
    } catch (err) {
      console.error("POST /api/noise-data failed", err);
      sendError(res, 500, "Failed to upload noise data");
    }
  });

  router.patch("/api/noise-data/uploads/:id", authMiddleware, adminOrAbove, async (req, res) => {
    const uploadId = requireValidId(req, res);
    if (uploadId === null) return;

    if (!requireVesselScopedAccount(req, res)) {
      return;
    }

    try {
      const { label, waterSpeedStart, waterSpeedEnd, recordedAt } = req.body || {};

      const setClauses = [];
      const params = [];

      if (label !== undefined) {
        const trimmed = typeof label === "string" ? label.trim() : "";
        if (!trimmed) return sendError(res, 400, "label must not be empty");
        setClauses.push("label = ?");
        params.push(trimmed);
      }

      if (waterSpeedStart !== undefined) {
        const val = waterSpeedStart === null ? null : parseFloat(waterSpeedStart);
        if (val !== null && isNaN(val)) return sendError(res, 400, "waterSpeedStart must be a number");
        setClauses.push("water_speed_start = ?");
        params.push(val);
      }

      if (waterSpeedEnd !== undefined) {
        const val = waterSpeedEnd === null ? null : parseFloat(waterSpeedEnd);
        if (val !== null && isNaN(val)) return sendError(res, 400, "waterSpeedEnd must be a number");
        setClauses.push("water_speed_end = ?");
        params.push(val);
      }

      // null or "" clears the sequence time, so the upload time is used again.
      if (recordedAt !== undefined) {
        const recorded = parseRecordedAt(recordedAt);
        if (recorded.error) return sendError(res, 400, recorded.error);
        setClauses.push("recorded_at = ?");
        params.push(recorded.value);
      }

      if (setClauses.length === 0) {
        return sendError(res, 400, "At least one field (label, waterSpeedStart, waterSpeedEnd, recordedAt) is required");
      }

      const upload = await getScopedUpload(uploadId, req.vesselScope);
      if (!upload) {
        return sendError(res, 404, "Noise upload not found");
      }

      params.push(uploadId);
      await runAsync(`UPDATE noise_uploads SET ${setClauses.join(", ")} WHERE id = ?`, params);

      const updatedUpload = await getScopedUpload(uploadId, req.vesselScope);
      res.json(withMeasuredAt(updatedUpload));
    } catch (err) {
      console.error("PATCH /api/noise-data/uploads/:id failed", err);
      sendError(res, 500, "Failed to update noise upload");
    }
  });

  router.delete("/api/noise-data/uploads/:id", authMiddleware, adminOrAbove, async (req, res) => {
    const uploadId = requireValidId(req, res);
    if (uploadId === null) return;

    if (!requireVesselScopedAccount(req, res)) {
      return;
    }

    try {
      const upload = await getScopedUpload(uploadId, req.vesselScope);
      if (!upload) {
        return sendError(res, 404, "Noise upload not found");
      }

      await runAsync("DELETE FROM noise_uploads WHERE id = ?", [uploadId]);
      res.json({ success: true });
    } catch (err) {
      console.error("DELETE /api/noise-data/uploads/:id failed", err);
      sendError(res, 500, "Failed to delete noise upload");
    }
  });

  return router;
}

module.exports = { createNoiseRouter };
