// routes/noise.js
const express = require("express");
const { runAsync, getAllCamelized, getOneCamelized } = require("../db");
const { sendError } = require("../utils/errors");

/**
 * Create noise data router (upload RMS batch, fetch by upload ID, list batches).
 * All noise data is scoped to a specific project.
 * @param {function} authMiddleware
 * @param {function} adminOrAbove
 * @returns {express.Router}
 */
function createNoiseRouter(authMiddleware, adminOrAbove) {
  const router = express.Router();

  // List all upload batches for a project, newest first
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

      const sql = `SELECT * FROM noise_uploads WHERE ${conditions.join(" AND ")} ORDER BY uploaded_at DESC`;
      const rows = await getAllCamelized(sql, params);
      res.json(rows);
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
          `SELECT * FROM noise_uploads WHERE ${conditions.join(" AND ")} ORDER BY uploaded_at DESC LIMIT 1`,
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

      res.json({
        uploadId: uploadRow.id,
        uploadedAt: uploadRow.uploadedAt,
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
      const { projectNumber, label, noiseData } = req.body;

      if (!projectNumber) {
        return sendError(res, 400, "projectNumber is required");
      }
      if (!noiseData || typeof noiseData !== "object") {
        return sendError(res, 400, "noiseData object is required");
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

      // Insert the batch header
      const headerResult = await runAsync(
        "INSERT INTO noise_uploads (project_number, vessel_tag, label) VALUES (?, ?, ?)",
        [projectNumber, project.vesselTag, label || null]
      );
      const uploadId = headerResult.lastID;

      // Bulk-insert measurements inside a transaction for atomicity
      await runAsync("BEGIN");
      try {
        for (const [cableNum, sections] of Object.entries(noiseData)) {
          const cableNumber = parseInt(cableNum, 10);
          for (const [sectionNum, rmsValue] of Object.entries(sections)) {
            // Skip zero values — sections not deployed on this cable
            if (!rmsValue || rmsValue <= 0) continue;
            await runAsync(
              "INSERT INTO noise_data (upload_id, cable_number, section_number, rms_value) VALUES (?, ?, ?, ?)",
              [uploadId, cableNumber, parseInt(sectionNum, 10), rmsValue]
            );
          }
        }
        await runAsync("COMMIT");
      } catch (insertErr) {
        await runAsync("ROLLBACK");
        throw insertErr;
      }

      const upload = await getOneCamelized(
        "SELECT * FROM noise_uploads WHERE id = ?",
        [uploadId]
      );

      res.status(201).json({ uploadId: upload.id, uploadedAt: upload.uploadedAt });
    } catch (err) {
      console.error("POST /api/noise-data failed", err);
      sendError(res, 500, "Failed to upload noise data");
    }
  });

  return router;
}

module.exports = { createNoiseRouter };
