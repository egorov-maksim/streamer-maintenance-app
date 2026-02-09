// routes/config.js
const express = require("express");
const humps = require("humps");
const { defaultConfig, loadConfig, saveConfig } = require("../config");
const { runAsync, getOneCamelized } = require("../db");
const { toInt } = require("../utils/validation");
const { sendError } = require("../utils/errors");

/**
 * Create config router (GET/PUT /api/config).
 * @param {function} authMiddleware
 * @param {function} superUserOnly
 * @returns {express.Router}
 */
function createConfigRouter(authMiddleware, superUserOnly) {
  const router = express.Router();

  router.get("/api/config", async (_req, res) => {
    try {
      const config = await loadConfig();
      res.json(humps.camelizeKeys(config));
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to load config");
    }
  });

  router.put("/api/config", authMiddleware, superUserOnly, async (req, res) => {
    try {
      const bodyData = humps.decamelizeKeys(req.body);
      const partial = {
        numCables: toInt(bodyData?.num_cables, defaultConfig.numCables),
        sectionsPerCable: toInt(bodyData?.sections_per_cable, defaultConfig.sectionsPerCable),
        sectionLength: toInt(bodyData?.section_length, defaultConfig.sectionLength),
        moduleFrequency: toInt(bodyData?.module_frequency, defaultConfig.moduleFrequency),
        useRopeForTail: Boolean(bodyData?.use_rope_for_tail),
        channelsPerSection: toInt(bodyData?.channels_per_section, defaultConfig.channelsPerSection),
        vesselTag: bodyData?.vessel_tag || defaultConfig.vesselTag,
      };
      if (bodyData?.active_project_number !== undefined) {
        partial.activeProjectNumber = bodyData.active_project_number || null;
      }

      const activeProject = await getOneCamelized("SELECT * FROM projects WHERE is_active = 1");
      if (activeProject) {
        await runAsync(
          `UPDATE projects SET
          num_cables = ?,
          sections_per_cable = ?,
          section_length = ?,
          module_frequency = ?,
          channels_per_section = ?,
          use_rope_for_tail = ?,
          vessel_tag = ?
        WHERE id = ?`,
          [
            partial.numCables,
            partial.sectionsPerCable,
            partial.sectionLength,
            partial.moduleFrequency,
            partial.channelsPerSection,
            partial.useRopeForTail ? 1 : 0,
            partial.vesselTag,
            activeProject.id,
          ]
        );
      } else {
        await saveConfig(partial);
      }

      const config = await loadConfig();
      res.json(humps.camelizeKeys(config));
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to save config");
    }
  });

  return router;
}

module.exports = { createConfigRouter };
