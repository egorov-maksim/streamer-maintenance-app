// routes/events.js
const express = require("express");
const humps = require("humps");
const { runAsync, getAllCamelized, getOneCamelized } = require("../db");
const { defaultConfig, loadConfig } = require("../config");
const { requireValidId } = require("../utils/validation");
const { sendError } = require("../utils/errors");
const { ROLES } = require("../middleware/auth");

/**
 * Create events router (CRUD, bulk delete).
 * @param {function} authMiddleware
 * @param {function} adminOrAbove
 * @returns {express.Router}
 */
function createEventsRouter(authMiddleware, adminOrAbove) {
  const router = express.Router();

  router.get("/api/events", async (req, res) => {
    try {
      const { project } = req.query;
      let sql = "SELECT * FROM cleaning_events";
      const params = [];
      if (project) {
        sql += " WHERE project_number = ?";
        params.push(project);
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

      let finalProjectNumber = project_number;
      let finalVesselTag = vessel_tag || defaultConfig.vesselTag;
      if (!finalProjectNumber) {
        const config = await loadConfig();
        finalProjectNumber = config.activeProjectNumber || null;
        finalVesselTag = config.vesselTag;
      }

      const result = await runAsync(
        `INSERT INTO cleaning_events (streamer_id, section_index_start, section_index_end, cleaning_method, cleaned_at, cleaning_count, project_number, vessel_tag)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          streamer_id,
          section_index_start,
          section_index_end,
          cleaning_method,
          cleaned_at,
          Number.isFinite(cleaning_count) ? cleaning_count : 1,
          finalProjectNumber,
          finalVesselTag,
        ]
      );
      const created = await getOneCamelized("SELECT * FROM cleaning_events WHERE id = ?", [result.lastID]);
      res.json(created);
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
      const finalProjectNumber = project_number !== undefined ? project_number : (existing?.projectNumber || null);
      const finalVesselTag = vessel_tag !== undefined ? vessel_tag : (existing?.vesselTag || defaultConfig.vesselTag);

      await runAsync(
        `UPDATE cleaning_events
       SET streamer_id = ?, section_index_start = ?, section_index_end = ?, cleaning_method = ?, cleaned_at = ?, cleaning_count = ?, project_number = ?, vessel_tag = ?
       WHERE id = ?`,
        [
          streamer_id,
          section_index_start,
          section_index_end,
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
      await runAsync("DELETE FROM cleaning_events WHERE id = ?", [id]);
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
        const result = await runAsync("DELETE FROM cleaning_events WHERE project_number = ?", [project]);
        return res.json({ success: true, deletedCount: result.changes });
      }
      if (req.user?.role !== ROLES.SUPER_USER) {
        return sendError(res, 403, "SuperUser access required for global clear");
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
