// routes/ebCleanings.js
const express = require("express");
const humps = require("humps");
const { runAsync, getAllCamelized, getOneCamelized } = require("../db");
const { defaultConfig, loadConfig } = require("../config");
const { getActiveProjectForVessel } = require("../activeProject");
const { requireValidId } = require("../utils/validation");
const { sendError, httpError, handleRouteError } = require("../utils/errors");
const { countEBModules } = require("../utils/eb");

/**
 * Resolves the project an eBird entry belongs to: the one named in the payload, or the
 * active project of the caller's vessel. Refuses unknown projects and other vessels' projects.
 * @param {Object} req - Express request (uses req.vesselScope)
 * @param {*} projectNumber - project number from the payload, may be empty
 * @param {Object} config - loaded app config
 * @returns {Promise<Object>} camelCase project row
 */
async function resolveProject(req, projectNumber, config) {
  if (projectNumber === undefined || projectNumber === null || projectNumber === "") {
    const vesselTag = req.vesselScope || config.vesselTag || defaultConfig.vesselTag;
    const active = await getActiveProjectForVessel(vesselTag);
    if (!active) throw httpError(400, "No active project for this vessel. Set an active project first.");
    return active;
  }
  const row = await getOneCamelized("SELECT * FROM projects WHERE project_number = ?", [projectNumber]);
  if (!row) throw httpError(400, `Project ${projectNumber} not found`);
  if (req.vesselScope && row.vesselTag !== req.vesselScope) {
    throw httpError(403, "Project does not belong to your vessel");
  }
  return row;
}

/**
 * Create the eBird cleaning router. eBirds (EB modules) are cleaned by hand, often at a
 * wing change between scraping runs, so their dates are kept apart from section cleaning
 * events and never enter distance, coverage or clean-count statistics.
 * @param {function} authMiddleware
 * @param {function} adminOrAbove
 * @returns {express.Router}
 */
function createEbCleaningsRouter(authMiddleware, adminOrAbove) {
  const router = express.Router();

  router.get("/api/eb-cleanings", authMiddleware, async (req, res) => {
    try {
      const { project } = req.query;
      const conditions = [];
      const params = [];
      if (project) {
        conditions.push("project_number = ?");
        params.push(project);
      }
      // Per-vessel scoping: non-global users only see their vessel's entries.
      if (req.vesselScope) {
        conditions.push("vessel_tag = ?");
        params.push(req.vesselScope);
      }
      const where = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";
      const rows = await getAllCamelized(
        `SELECT * FROM eb_cleaning_events${where} ORDER BY datetime(cleaned_at) DESC, id DESC`,
        params
      );
      res.json(rows);
    } catch (err) {
      handleRouteError(res, err, "Failed to fetch eBird cleanings");
    }
  });

  router.post("/api/eb-cleanings", authMiddleware, adminOrAbove, async (req, res) => {
    try {
      const body = humps.decamelizeKeys(req.body || {});
      const { streamer_id, eb_number, cleaned_at, project_number } = body;
      if (!Number.isInteger(streamer_id) || !Number.isInteger(eb_number) || typeof cleaned_at !== "string") {
        return sendError(res, 400, "Invalid payload");
      }
      if (Number.isNaN(new Date(cleaned_at).getTime())) {
        return sendError(res, 400, "Invalid cleaning date");
      }

      const config = await loadConfig();
      const project = await resolveProject(req, project_number, config);

      const maxCables = project.numCables ?? config.numCables;
      if (streamer_id < 1 || streamer_id > maxCables) {
        return sendError(res, 400, `Streamer must be between 1 and ${maxCables}`);
      }

      // A streamer can be shorter than the project default, which also shortens its EB run.
      const override = await getOneCamelized(
        "SELECT sections_per_cable FROM streamer_deployments WHERE project_id = ? AND streamer_id = ? AND sections_per_cable IS NOT NULL",
        [project.id, streamer_id]
      );
      const sections = override?.sectionsPerCable ?? project.sectionsPerCable ?? config.sectionsPerCable;
      const maxEb = countEBModules(sections, project.moduleFrequency ?? config.moduleFrequency);
      if (eb_number < 1 || eb_number > maxEb) {
        return sendError(res, 400, `EB number must be between 1 and ${maxEb}`);
      }

      const result = await runAsync(
        `INSERT INTO eb_cleaning_events (streamer_id, eb_number, cleaned_at, project_number, vessel_tag, added_by_usertag)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          streamer_id,
          eb_number,
          new Date(cleaned_at).toISOString(),
          project.projectNumber,
          req.vesselScope || project.vesselTag || defaultConfig.vesselTag,
          req.user?.username ?? null,
        ]
      );
      res.json(await getOneCamelized("SELECT * FROM eb_cleaning_events WHERE id = ?", [result.lastID]));
    } catch (err) {
      handleRouteError(res, err, "Failed to save eBird cleaning");
    }
  });

  router.delete("/api/eb-cleanings/:id", authMiddleware, adminOrAbove, async (req, res) => {
    try {
      const id = requireValidId(req, res);
      if (id === null) return;
      const params = [id];
      let sql = "DELETE FROM eb_cleaning_events WHERE id = ?";
      // Per-vessel users may only delete entries for their vessel.
      if (req.vesselScope) {
        sql += " AND vessel_tag = ?";
        params.push(req.vesselScope);
      }
      const result = await runAsync(sql, params);
      if (result.changes === 0) return sendError(res, 404, "eBird cleaning not found");
      res.json({ success: true });
    } catch (err) {
      handleRouteError(res, err, "Failed to delete eBird cleaning");
    }
  });

  return router;
}

module.exports = { createEbCleaningsRouter };
