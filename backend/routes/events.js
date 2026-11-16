// routes/events.js
const express = require("express");
const humps = require("humps");
const { runAsync, getAllCamelized, getOneCamelized } = require("../db");
const { defaultConfig, loadConfig } = require("../config");
const { getActiveProjectForVessel } = require("../activeProject");
const { requireValidId, isSafeText } = require("../utils/validation");
const { sendError, httpError } = require("../utils/errors");
const { ROLES, isGlobalUser } = require("../middleware/auth");
const { splitSectionRange, validateRangeForType } = require("../utils/sectionType");

/**
 * Look up the effective sectionsPerCable for a specific streamer in a project,
 * falling back to the project/global default when no per-streamer override is set.
 * @param {number|null} projectId
 * @param {number} streamerId
 * @param {number} defaultSections
 * @returns {Promise<number>}
 */
async function getStreamerSectionsPerCable(projectId, streamerId, defaultSections) {
  if (projectId == null) return defaultSections;
  const row = await getOneCamelized(
    "SELECT sections_per_cable FROM streamer_deployments WHERE project_id = ? AND streamer_id = ? AND sections_per_cable IS NOT NULL",
    [projectId, streamerId]
  );
  return row?.sectionsPerCable ?? defaultSections;
}

/**
 * Refuses writes against a project the caller may not use: unknown project numbers
 * (previously surfaced as a FK 500) and, for vessel-scoped users, projects of other vessels.
 * @param {Object} req - Express request (uses req.vesselScope)
 * @param {Object|null} projectRow - camelCase project row or null
 * @param {string} projectNumber - project number that was looked up (for the message)
 * @returns {Error|null} httpError to send, or null when access is fine
 */
function projectAccessError(req, projectRow, projectNumber) {
  if (!projectRow) return httpError(400, `Project ${projectNumber} not found`);
  if (req.vesselScope && projectRow.vesselTag !== req.vesselScope) {
    return httpError(403, "Project does not belong to your vessel");
  }
  return null;
}

/**
 * Keeps streamer ids inside the cable count of the event's project (or the global
 * default when the project has none), so imports cannot create events for cables
 * that no heatmap will ever show.
 * @param {number} streamerId
 * @param {Object|null} projectRow
 * @param {Object} config - loaded app config
 * @returns {Error|null}
 */
function streamerBoundError(streamerId, projectRow, config) {
  const maxCables = projectRow?.numCables ?? config.numCables;
  if (!Number.isInteger(streamerId) || streamerId < 1 || (Number.isFinite(maxCables) && streamerId > maxCables)) {
    return httpError(400, `Streamer must be between 1 and ${maxCables}`);
  }
  return null;
}

/**
 * Rejects markup or control characters in the free-text fields the SPA renders.
 * @param {string} cleaningMethod
 * @param {*} addedByUsertag - optional
 * @returns {Error|null}
 */
function eventTextError(cleaningMethod, addedByUsertag) {
  if (!isSafeText(cleaningMethod)) return httpError(400, "Invalid cleaning method");
  if (addedByUsertag != null && !isSafeText(String(addedByUsertag), { allowEmpty: true })) {
    return httpError(400, "Invalid added_by_usertag");
  }
  return null;
}

/**
 * Create events router (CRUD, bulk delete).
 * @param {function} authMiddleware
 * @param {function} adminOrAbove
 * @returns {express.Router}
 */
function createEventsRouter(authMiddleware, adminOrAbove) {
  const router = express.Router();

  router.get("/api/events", authMiddleware, async (req, res) => {
    try {
      const { project } = req.query;
      let sql = "SELECT * FROM cleaning_events";
      const params = [];
      const conditions = [];

      if (project) {
        conditions.push("project_number = ?");
        params.push(project);
      }

      // Per-vessel scoping: non-global users only see their vessel's events.
      if (req.vesselScope) {
        conditions.push("vessel_tag = ?");
        params.push(req.vesselScope);
      }

      if (conditions.length > 0) {
        sql += " WHERE " + conditions.join(" AND ");
      }

      sql += " ORDER BY datetime(cleaned_at) DESC";
      const rows = await getAllCamelized(sql, params);
      res.json(rows);
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to fetch events");
    }
  });

  router.post("/api/events", authMiddleware, adminOrAbove, async (req, res) => {
    try {
      const bodyData = humps.decamelizeKeys(req.body);
      const {
        streamer_id,
        section_index_start,
        section_index_end,
        section_type: body_section_type,
        cleaning_method,
        cleaned_at,
        cleaning_count,
        project_number,
        vessel_tag,
      } = bodyData;

      if (
        !Number.isFinite(streamer_id) ||
        !Number.isFinite(section_index_start) ||
        !Number.isFinite(section_index_end) ||
        typeof cleaning_method !== "string" ||
        typeof cleaned_at !== "string"
      ) {
        return sendError(res, 400, "Invalid payload");
      }
      const textErr = eventTextError(cleaning_method, bodyData.added_by_usertag);
      if (textErr) return sendError(res, textErr.status, textErr.message);

      const config = await loadConfig();
      const projectNumberMissing = project_number === undefined || project_number === null || project_number === "";
      let finalProjectNumber = projectNumberMissing ? null : project_number;
      let finalVesselTag = vessel_tag || defaultConfig.vesselTag;
      let activeProject = null;
      if (finalProjectNumber === undefined || finalProjectNumber === null) {
        const vesselTagForResolve = req.vesselScope || config.vesselTag || defaultConfig.vesselTag;
        activeProject = vesselTagForResolve
          ? await getActiveProjectForVessel(vesselTagForResolve)
          : null;
        if (!activeProject) {
          return sendError(
            res,
            400,
            "No active project for this vessel. Set an active project first."
          );
        }
        finalProjectNumber = activeProject.projectNumber;
        finalVesselTag = activeProject.vesselTag || defaultConfig.vesselTag;
      }
      if (req.vesselScope) {
        finalVesselTag = req.vesselScope;
      }
      const projectRow = activeProject || await getOneCamelized("SELECT * FROM projects WHERE project_number = ?", [finalProjectNumber]);
      const accessErr = projectAccessError(req, projectRow, finalProjectNumber);
      if (accessErr) return sendError(res, accessErr.status, accessErr.message);
      const boundErr = streamerBoundError(streamer_id, projectRow, config);
      if (boundErr) return sendError(res, boundErr.status, boundErr.message);
      const defaultSections = projectRow?.sectionsPerCable ?? config.sectionsPerCable;
      const effectiveSections = await getStreamerSectionsPerCable(projectRow?.id ?? null, streamer_id, defaultSections);
      const eventConfig = {
        ...config,
        sectionsPerCable: effectiveSections,
        useRopeForTail: projectRow != null ? projectRow.useRopeForTail === 1 : config.useRopeForTail,
      };
      const count = Number.isFinite(cleaning_count) ? cleaning_count : 1;
      const addedByUsertag = bodyData.added_by_usertag != null
        ? String(bodyData.added_by_usertag).trim() || null
        : (req.user?.username ?? null);

      const insertOne = async (sectionType, start, end) => {
        const result = await runAsync(
          `INSERT INTO cleaning_events (streamer_id, section_index_start, section_index_end, section_type, cleaning_method, cleaned_at, cleaning_count, project_number, vessel_tag, added_by_usertag)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            streamer_id,
            start,
            end,
            sectionType,
            cleaning_method,
            cleaned_at,
            count,
            finalProjectNumber,
            finalVesselTag,
            addedByUsertag,
          ]
        );
        return getOneCamelized("SELECT * FROM cleaning_events WHERE id = ?", [result.lastID]);
      };

      const explicitSectionType = body_section_type === "active" || body_section_type === "tail" ? body_section_type : null;
      if (explicitSectionType) {
        const validation = validateRangeForType(
          section_index_start,
          section_index_end,
          explicitSectionType,
          eventConfig
        );
        if (!validation.valid) {
          return sendError(res, 400, validation.message);
        }
        const created = await insertOne(explicitSectionType, section_index_start, section_index_end);
        return res.json(created);
      }

      const { active, tail } = splitSectionRange(
        section_index_start,
        section_index_end,
        eventConfig
      );

      if (!active && !tail) {
        return sendError(res, 400, "Section range out of bounds or tail sections not configured");
      }

      if (active && tail) {
        const [createdActive, createdTail] = await Promise.all([
          insertOne("active", active.start, active.end),
          insertOne("tail", tail.start, tail.end),
        ]);
        return res.json({ created: [createdActive, createdTail] });
      }
      if (active) {
        const created = await insertOne("active", active.start, active.end);
        return res.json(created);
      }
      const created = await insertOne("tail", tail.start, tail.end);
      return res.json(created);
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to create event");
    }
  });

  router.put("/api/events/:id", authMiddleware, adminOrAbove, async (req, res) => {
    try {
      const id = requireValidId(req, res);
      if (id === null) return;

      const bodyData = humps.decamelizeKeys(req.body);
      const {
        streamer_id,
        section_index_start,
        section_index_end,
        section_type: body_section_type,
        cleaning_method,
        cleaned_at,
        cleaning_count,
        project_number,
        vessel_tag,
      } = bodyData;
      if (
        !Number.isFinite(streamer_id) ||
        !Number.isFinite(section_index_start) ||
        !Number.isFinite(section_index_end) ||
        typeof cleaning_method !== "string" ||
        typeof cleaned_at !== "string"
      ) {
        return sendError(res, 400, "Invalid payload");
      }
      const textErr = eventTextError(cleaning_method, bodyData.added_by_usertag);
      if (textErr) return sendError(res, textErr.status, textErr.message);

      const existing = await getOneCamelized("SELECT * FROM cleaning_events WHERE id = ?", [id]);
      if (!existing) {
        return sendError(res, 404, "Event not found");
      }

      // Per-vessel users cannot modify events from another vessel.
      if (req.vesselScope && existing.vesselTag && existing.vesselTag !== req.vesselScope) {
        return sendError(res, 403, "Cannot modify events from another vessel");
      }
      const sectionType = body_section_type ?? existing?.sectionType ?? "active";
      const config = await loadConfig();
      // Derive effective config for this event's project (matches POST handler logic).
      const projectNumberFromBody =
        project_number !== undefined && project_number !== null && project_number !== ""
          ? project_number
          : null;
      const effectiveProjectNumber = projectNumberFromBody || existing.projectNumber || null;
      const projectChanged = Boolean(projectNumberFromBody) && projectNumberFromBody !== existing.projectNumber;
      let eventConfig = config;
      let projectRow = null;
      if (effectiveProjectNumber) {
        projectRow = await getOneCamelized(
          "SELECT * FROM projects WHERE project_number = ?",
          [effectiveProjectNumber]
        );
        if (projectChanged) {
          const accessErr = projectAccessError(req, projectRow, effectiveProjectNumber);
          if (accessErr) return sendError(res, accessErr.status, accessErr.message);
        }
        if (projectRow) {
          const defaultSections = projectRow.sectionsPerCable ?? config.sectionsPerCable;
          const effectiveSections = await getStreamerSectionsPerCable(projectRow.id, streamer_id, defaultSections);
          eventConfig = {
            ...config,
            sectionsPerCable: effectiveSections,
            useRopeForTail:
              projectRow.useRopeForTail === 1
                ? true
                : projectRow.useRopeForTail === 0
                ? false
                : config.useRopeForTail,
          };
        }
      }
      // Legacy rows for since-removed cables stay editable; the bound applies once the
      // streamer or project is actually being changed.
      if (projectChanged || streamer_id !== existing.streamerId) {
        const boundErr = streamerBoundError(streamer_id, projectRow, config);
        if (boundErr) return sendError(res, boundErr.status, boundErr.message);
      }
      const validation = validateRangeForType(
        section_index_start,
        section_index_end,
        sectionType,
        eventConfig
      );
      if (!validation.valid) {
        return sendError(res, 400, validation.message);
      }

      const finalProjectNumber =
        project_number !== undefined ? project_number : existing.projectNumber || null;

      let finalVesselTag =
        vessel_tag !== undefined ? vessel_tag : existing.vesselTag || defaultConfig.vesselTag;
      if (req.vesselScope) {
        finalVesselTag = req.vesselScope;
      }

      await runAsync(
        `UPDATE cleaning_events
       SET streamer_id = ?, section_index_start = ?, section_index_end = ?, section_type = ?, cleaning_method = ?, cleaned_at = ?, cleaning_count = ?, project_number = ?, vessel_tag = ?
       WHERE id = ?`,
        [
          streamer_id,
          section_index_start,
          section_index_end,
          sectionType,
          cleaning_method,
          cleaned_at,
          Number.isFinite(cleaning_count) ? cleaning_count : 1,
          finalProjectNumber,
          finalVesselTag,
          id,
        ]
      );
      const updated = await getOneCamelized("SELECT * FROM cleaning_events WHERE id = ?", [id]);
      res.json(updated);
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to update event");
    }
  });

  router.delete("/api/events/:id", authMiddleware, adminOrAbove, async (req, res) => {
    try {
      const id = requireValidId(req, res);
      if (id === null) return;

      const params = [id];
      let sql = "DELETE FROM cleaning_events WHERE id = ?";
      // Per-vessel users may only delete events for their vessel.
      if (req.vesselScope) {
        sql += " AND vessel_tag = ?";
        params.push(req.vesselScope);
      }

      const result = await runAsync(sql, params);
      if (result.changes === 0) {
        return sendError(res, 404, "Event not found");
      }
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to delete event");
    }
  });

  /**
   * POST /api/events/bulk
   * Accepts { rows: [...] } where each row has the same shape as POST /api/events.
   * Processes rows sequentially using the same validation + split logic.
   * Returns { successCount, errorCount, errors[] } — never throws on partial failure.
   */
  router.post("/api/events/bulk", authMiddleware, adminOrAbove, async (req, res) => {
    try {
      const { rows } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return sendError(res, 400, "rows must be a non-empty array");
      }

      const config = await loadConfig();
      let successCount = 0;
      const errors = [];

      for (const row of rows) {
        try {
          const bodyData = humps.decamelizeKeys(row);
          const {
            streamer_id,
            section_index_start,
            section_index_end,
            section_type: body_section_type,
            cleaning_method,
            cleaned_at,
            cleaning_count,
            project_number,
            vessel_tag,
            added_by_usertag,
          } = bodyData;

          if (
            !Number.isFinite(streamer_id) ||
            !Number.isFinite(section_index_start) ||
            !Number.isFinite(section_index_end) ||
            typeof cleaning_method !== "string" ||
            typeof cleaned_at !== "string"
          ) {
            errors.push({ row, reason: "Invalid payload" });
            continue;
          }
          const textErr = eventTextError(cleaning_method, added_by_usertag);
          if (textErr) {
            errors.push({ row, reason: textErr.message });
            continue;
          }

          let finalProjectNumber = project_number ?? null;
          let finalVesselTag = vessel_tag || "TTN";
          let activeProject = null;

          if (finalProjectNumber === null || finalProjectNumber === undefined) {
            const vesselTagForResolve = req.vesselScope || config.vesselTag || "TTN";
            activeProject = vesselTagForResolve
              ? await getActiveProjectForVessel(vesselTagForResolve)
              : null;
            if (!activeProject) {
              errors.push({ row, reason: "No active project for this vessel" });
              continue;
            }
            finalProjectNumber = activeProject.projectNumber;
            finalVesselTag = activeProject.vesselTag || "TTN";
          }

          if (req.vesselScope) finalVesselTag = req.vesselScope;

          const projectRow = activeProject ||
            await getOneCamelized("SELECT * FROM projects WHERE project_number = ?", [finalProjectNumber]);
          const accessErr = projectAccessError(req, projectRow, finalProjectNumber);
          if (accessErr) {
            errors.push({ row, reason: accessErr.message });
            continue;
          }
          const boundErr = streamerBoundError(streamer_id, projectRow, config);
          if (boundErr) {
            errors.push({ row, reason: boundErr.message });
            continue;
          }

          const defaultSections = projectRow?.sectionsPerCable ?? config.sectionsPerCable;
          const effectiveSections = await getStreamerSectionsPerCable(projectRow?.id ?? null, streamer_id, defaultSections);
          const eventConfig = {
            ...config,
            sectionsPerCable: effectiveSections,
            useRopeForTail: projectRow != null
              ? projectRow.useRopeForTail === 1
              : config.useRopeForTail,
          };

          const count = Number.isFinite(cleaning_count) ? cleaning_count : 1;
          const addedBy = added_by_usertag != null
            ? String(added_by_usertag).trim() || null
            : (req.user?.username ?? null);

          const insertOne = async (sectionType, start, end) => {
            await runAsync(
              `INSERT INTO cleaning_events
                (streamer_id, section_index_start, section_index_end, section_type,
                 cleaning_method, cleaned_at, cleaning_count, project_number, vessel_tag, added_by_usertag)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [streamer_id, start, end, sectionType, cleaning_method, cleaned_at,
               count, finalProjectNumber, finalVesselTag, addedBy]
            );
          };

          const explicitType =
            body_section_type === "active" || body_section_type === "tail"
              ? body_section_type
              : null;

          if (explicitType) {
            const validation = validateRangeForType(
              section_index_start, section_index_end, explicitType, eventConfig
            );
            if (!validation.valid) {
              errors.push({ row, reason: validation.message });
              continue;
            }
            await insertOne(explicitType, section_index_start, section_index_end);
          } else {
            const { active, tail } = splitSectionRange(
              section_index_start, section_index_end, eventConfig
            );
            if (!active && !tail) {
              errors.push({ row, reason: "Section range out of bounds" });
              continue;
            }
            if (active) await insertOne("active", active.start, active.end);
            if (tail) await insertOne("tail", tail.start, tail.end);
          }

          successCount++;
        } catch (rowErr) {
          errors.push({ row, reason: rowErr.message || "Insert failed" });
        }
      }

      res.json({ successCount, errorCount: errors.length, errors });
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Bulk import failed");
    }
  });

  router.delete("/api/events", authMiddleware, adminOrAbove, async (req, res) => {
    try {
      const project = req.query.project;
      if (project) {
        // Per-vessel users can only clear events for their own vessel, even when a project is specified.
        const params = [project];
        let sql = "DELETE FROM cleaning_events WHERE project_number = ?";
        if (req.vesselScope) {
          sql += " AND vessel_tag = ?";
          params.push(req.vesselScope);
        }

        const result = await runAsync(sql, params);
        return res.json({ success: true, deletedCount: result.changes });
      }

      // Global clear: only allowed for global superusers (including grand superuser).
      if (!isGlobalUser(req.user) || (req.user.role !== ROLES.SUPER_USER && req.user.role !== ROLES.GRAND_SUPER_USER)) {
        return sendError(res, 403, "Grand SuperUser access required for global clear");
      }

      const result = await runAsync("DELETE FROM cleaning_events");
      res.json({ success: true, deletedCount: result.changes });
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to clear events");
    }
  });

  return router;
}

module.exports = { createEventsRouter };
