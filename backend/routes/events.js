// routes/events.js
const express = require("express");
const humps = require("humps");
const { runAsync, getAllCamelized, getOneCamelized } = require("../db");
const { defaultConfig, loadConfig } = require("../config");
const { getActiveProjectForVessel } = require("../activeProject");
const { requireValidId } = require("../utils/validation");
const { sendError } = require("../utils/errors");
const { ROLES, isGlobalUser } = require("../middleware/auth");
const { splitSectionRange, validateRangeForType } = require("../utils/sectionType");

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

      const config = await loadConfig();
      let finalProjectNumber = project_number;
      let finalVesselTag = vessel_tag || defaultConfig.vesselTag;
      if (finalProjectNumber === undefined || finalProjectNumber === null) {
        const vesselTagForResolve = req.vesselScope || config.vesselTag;
        const activeProject = vesselTagForResolve
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
      const count = Number.isFinite(cleaning_count) ? cleaning_count : 1;

      const insertOne = async (sectionType, start, end) => {
        const result = await runAsync(
          `INSERT INTO cleaning_events (streamer_id, section_index_start, section_index_end, section_type, cleaning_method, cleaned_at, cleaning_count, project_number, vessel_tag)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          config
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
        config
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
      const validation = validateRangeForType(
        section_index_start,
        section_index_end,
        sectionType,
        config
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
