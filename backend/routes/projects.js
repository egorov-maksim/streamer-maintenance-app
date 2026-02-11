// routes/projects.js
const express = require("express");
const humps = require("humps");
const { runAsync, getAsync, allAsync, getAllCamelized, getOneCamelized } = require("../db");
const { defaultConfig, loadConfig, saveConfig } = require("../config");
const { requireValidId, toInt } = require("../utils/validation");
const { sendError } = require("../utils/errors");
const { isGlobalUser } = require("../middleware/auth");

/**
 * Create projects router (CRUD, activate, streamer-deployments, cleanup).
 * @param {function} authMiddleware
 * @param {function} superUserOnly
 * @returns {express.Router}
 */
function createProjectsRouter(authMiddleware, superUserOnly) {
  const router = express.Router();

  router.get("/api/projects/stats", authMiddleware, async (req, res) => {
    try {
      const params = [];
      let where = "WHERE project_number IS NOT NULL";

      if (req.vesselScope) {
        where += " AND vessel_tag = ?";
        params.push(req.vesselScope);
      }

      const rows = await allAsync(
        `
        SELECT project_number, COUNT(*) as event_count
        FROM cleaning_events
        ${where}
        GROUP BY project_number
      `,
        params
      );
      const stats = {};
      for (const row of rows) {
        const camelized = humps.camelizeKeys(row);
        stats[camelized.projectNumber] = camelized.eventCount;
      }
      res.json(stats);
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to get project stats");
    }
  });

  router.get("/api/projects", authMiddleware, async (req, res) => {
    try {
      const params = [];
      let sql = "SELECT * FROM projects";
      if (req.vesselScope) {
        sql += " WHERE vessel_tag = ?";
        params.push(req.vesselScope);
      }
      sql += " ORDER BY created_at DESC";

      const rows = await getAllCamelized(sql, params);
      res.json(
        rows.map((p) => ({
          ...p,
          useRopeForTail: p.useRopeForTail === 1,
          isActive: p.isActive === 1,
        }))
      );
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to fetch projects");
    }
  });

  router.get("/api/projects/active", authMiddleware, async (req, res) => {
    try {
      const params = [];
      let sql = "SELECT * FROM projects WHERE is_active = 1";
      if (req.vesselScope) {
        sql += " AND vessel_tag = ?";
        params.push(req.vesselScope);
      }

      const project = await getOneCamelized(sql, params);
      if (!project) return res.json(null);
      res.json({
        ...project,
        useRopeForTail: project.useRopeForTail === 1,
        isActive: project.isActive === 1,
      });
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to fetch active project");
    }
  });

  router.post("/api/projects", authMiddleware, superUserOnly, async (req, res) => {
    try {
      const bodyData = humps.decamelizeKeys(req.body);
      const {
        project_number,
        project_name,
        vessel_tag,
        num_cables,
        sections_per_cable,
        section_length,
        module_frequency,
        channels_per_section,
        use_rope_for_tail,
      } = bodyData;

      if (!project_number || typeof project_number !== "string") {
        return sendError(res, 400, "Project number is required");
      }

      const created_at = new Date().toISOString();

      // Determine effective vessel tag:
      // - Global users may choose or fall back to default.
      // - Per-vessel users are always scoped to their vessel.
      let effectiveVesselTag = vessel_tag || defaultConfig.vesselTag;
      if (req.vesselScope) {
        effectiveVesselTag = req.vesselScope;
      }

      const result = await runAsync(
        `INSERT INTO projects (
        project_number, project_name, vessel_tag, created_at, is_active,
        num_cables, sections_per_cable, section_length, module_frequency, channels_per_section, use_rope_for_tail
      ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
        [
          project_number,
          project_name || null,
          effectiveVesselTag,
          created_at,
          toInt(num_cables, defaultConfig.numCables),
          toInt(sections_per_cable, defaultConfig.sectionsPerCable),
          toInt(section_length, defaultConfig.sectionLength),
          toInt(module_frequency, defaultConfig.moduleFrequency),
          toInt(channels_per_section, defaultConfig.channelsPerSection),
          use_rope_for_tail === false ? 0 : 1,
        ]
      );

      const created = await getOneCamelized("SELECT * FROM projects WHERE id = ?", [result.lastID]);
      if (created) {
        res.json({
          ...created,
          useRopeForTail: created.useRopeForTail === 1,
          isActive: created.isActive === 1,
        });
      } else {
        sendError(res, 500, "Failed to fetch created project");
      }
    } catch (err) {
      console.error(err);
      if (err.message?.includes("UNIQUE constraint failed")) {
        sendError(res, 400, "Project number already exists");
      } else {
        sendError(res, 500, "Failed to create project");
      }
    }
  });

  router.put("/api/projects/:id/activate", authMiddleware, superUserOnly, async (req, res) => {
    try {
      const id = requireValidId(req, res);
      if (id === null) return;

      // Only allow activation of projects within user's vessel scope.
      const projectRow = await getOneCamelized("SELECT * FROM projects WHERE id = ?", [id]);
      if (!projectRow) {
        return sendError(res, 404, "Project not found");
      }
      if (req.vesselScope && projectRow.vesselTag !== req.vesselScope) {
        return sendError(res, 403, "Cannot activate project from another vessel");
      }

      await runAsync("UPDATE projects SET is_active = 0");
      await runAsync("UPDATE projects SET is_active = 1 WHERE id = ?", [id]);

      const project = await getOneCamelized("SELECT * FROM projects WHERE id = ?", [id]);
      if (project) {
        await saveConfig({
          activeProjectNumber: project.projectNumber,
          vesselTag: project.vesselTag || defaultConfig.vesselTag,
          numCables: project.numCables || defaultConfig.numCables,
          sectionsPerCable: project.sectionsPerCable || defaultConfig.sectionsPerCable,
          sectionLength: project.sectionLength || defaultConfig.sectionLength,
          moduleFrequency: project.moduleFrequency || defaultConfig.moduleFrequency,
          channelsPerSection: project.channelsPerSection || defaultConfig.channelsPerSection,
          useRopeForTail: project.useRopeForTail === 1,
        });
      }

      if (project) {
        res.json({
          ...project,
          useRopeForTail: project.useRopeForTail === 1,
          isActive: project.isActive === 1,
        });
      } else {
        sendError(res, 404, "Project not found");
      }
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to activate project");
    }
  });

  router.put("/api/projects/:id", authMiddleware, superUserOnly, async (req, res) => {
    try {
      const id = requireValidId(req, res);
      if (id === null) return;

      const existing = await getOneCamelized("SELECT * FROM projects WHERE id = ?", [id]);
      if (!existing) {
        return sendError(res, 404, "Project not found");
      }
      if (req.vesselScope && existing.vesselTag !== req.vesselScope) {
        return sendError(res, 403, "Cannot update project from another vessel");
      }

      const bodyData = humps.decamelizeKeys(req.body);
      const {
        project_name,
        vessel_tag,
        num_cables,
        sections_per_cable,
        section_length,
        module_frequency,
        channels_per_section,
        use_rope_for_tail,
        comments,
      } = bodyData;

      // Determine effective vessel tag for update.
      let effectiveVesselTag = vessel_tag || existing.vesselTag || defaultConfig.vesselTag;
      if (req.vesselScope) {
        effectiveVesselTag = req.vesselScope;
      }

      await runAsync(
        `UPDATE projects SET
        project_name = ?,
        vessel_tag = ?,
        num_cables = ?,
        sections_per_cable = ?,
        section_length = ?,
        module_frequency = ?,
        channels_per_section = ?,
        use_rope_for_tail = ?,
        comments = ?
      WHERE id = ?`,
        [
          project_name || null,
          effectiveVesselTag,
          toInt(num_cables, defaultConfig.numCables),
          toInt(sections_per_cable, defaultConfig.sectionsPerCable),
          toInt(section_length, defaultConfig.sectionLength),
          toInt(module_frequency, defaultConfig.moduleFrequency),
          toInt(channels_per_section, defaultConfig.channelsPerSection),
          use_rope_for_tail === false ? 0 : 1,
          comments !== undefined ? comments : null,
          id,
        ]
      );

      const updated = await getOneCamelized("SELECT * FROM projects WHERE id = ?", [id]);
      if (updated && updated.isActive === 1) {
        await saveConfig({
          vesselTag: updated.vesselTag || defaultConfig.vesselTag,
          numCables: updated.numCables || defaultConfig.numCables,
          sectionsPerCable: updated.sectionsPerCable || defaultConfig.sectionsPerCable,
          sectionLength: updated.sectionLength || defaultConfig.sectionLength,
          moduleFrequency: updated.moduleFrequency || defaultConfig.moduleFrequency,
          channelsPerSection: updated.channelsPerSection || defaultConfig.channelsPerSection,
          useRopeForTail: updated.useRopeForTail === 1,
        });
      }

      if (updated) {
        res.json({
          ...updated,
          useRopeForTail: updated.useRopeForTail === 1,
          isActive: updated.isActive === 1,
        });
      } else {
        sendError(res, 404, "Project not found");
      }
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to update project");
    }
  });

  router.post("/api/projects/deactivate", authMiddleware, superUserOnly, async (_req, res) => {
    try {
      // Deactivating all projects is a global operation; restrict to global superusers.
      if (!isGlobalUser(_req.user)) {
        return sendError(res, 403, "Grand SuperUser access required to deactivate all projects");
      }

      await runAsync("UPDATE projects SET is_active = 0");
      await saveConfig({ activeProjectNumber: null });
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to deactivate projects");
    }
  });

  router.delete("/api/projects/:id", authMiddleware, superUserOnly, async (req, res) => {
    try {
      const id = requireValidId(req, res);
      if (id === null) return;

      const project = await getAsync("SELECT * FROM projects WHERE id = ?", [id]);
      if (!project) return sendError(res, 404, "Project not found");

      if (req.vesselScope && project.vessel_tag !== req.vesselScope) {
        return sendError(res, 403, "Cannot delete project from another vessel");
      }

      const eventCount = await getAsync(
        "SELECT COUNT(*) as count FROM cleaning_events WHERE project_number = ?",
        [project.project_number]
      );
      const deploymentCount = await getAsync(
        "SELECT COUNT(*) as count FROM streamer_deployments WHERE project_id = ?",
        [id]
      );

      if (eventCount.count > 0 || deploymentCount.count > 0) {
        return res.status(409).json({
          requiresConfirmation: true,
          eventCount: eventCount.count,
          deploymentCount: deploymentCount.count,
        });
      }

      await runAsync("DELETE FROM projects WHERE id = ?", [id]);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to delete project");
    }
  });

  router.delete("/api/projects/:id/force", authMiddleware, superUserOnly, async (req, res) => {
    try {
      const id = requireValidId(req, res);
      if (id === null) return;

      const project = await getAsync("SELECT * FROM projects WHERE id = ?", [id]);
      if (!project) return sendError(res, 404, "Project not found");

      if (req.vesselScope && project.vessel_tag !== req.vesselScope) {
        return sendError(res, 403, "Cannot delete project from another vessel");
      }

      await runAsync("DELETE FROM cleaning_events WHERE project_number = ?", [project.project_number]);
      await runAsync("DELETE FROM streamer_deployments WHERE project_id = ?", [id]);
      await runAsync("DELETE FROM projects WHERE id = ?", [id]);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to force delete project");
    }
  });

  router.get("/api/projects/:id/streamer-deployments", authMiddleware, async (req, res) => {
    try {
      const id = requireValidId(req, res);
      if (id === null) return;

      const project = await getAsync("SELECT * FROM projects WHERE id = ?", [id]);
      if (!project) return sendError(res, 404, "Project not found");
      if (req.vesselScope && project.vessel_tag !== req.vesselScope) {
        return sendError(res, 403, "Cannot view deployments for project from another vessel");
      }

      const rows = await getAllCamelized(
        "SELECT streamer_id, deployment_date, is_coated FROM streamer_deployments WHERE project_id = ?",
        [id]
      );
      const result = {};
      for (const row of rows) {
        const isCoated = row.isCoated === 1 ? true : row.isCoated === 0 ? false : null;
        result[row.streamerId] = {
          deploymentDate: row.deploymentDate || null,
          isCoated,
        };
      }
      res.json(result);
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to fetch streamer deployments");
    }
  });

  router.put("/api/projects/:id/streamer-deployments", authMiddleware, superUserOnly, async (req, res) => {
    try {
      const id = requireValidId(req, res);
      if (id === null) return;

      const project = await getAsync("SELECT * FROM projects WHERE id = ?", [id]);
      if (!project) return sendError(res, 404, "Project not found");
      if (req.vesselScope && project.vessel_tag !== req.vesselScope) {
        return sendError(res, 403, "Cannot update deployments for project from another vessel");
      }

      const bodyData = humps.decamelizeKeys(req.body);
      for (const [streamerNum, data] of Object.entries(bodyData)) {
        const streamerId = parseInt(streamerNum, 10);
        const deploymentDate = data.deployment_date || null;
        const isCoatedVal =
          data.is_coated === true || data.is_coated === 1 ? 1 : data.is_coated === false || data.is_coated === 0 ? 0 : null;
        await runAsync(
          `INSERT INTO streamer_deployments (project_id, streamer_id, deployment_date, is_coated)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id, streamer_id)
         DO UPDATE SET deployment_date = excluded.deployment_date, is_coated = excluded.is_coated`,
          [id, streamerId, deploymentDate, isCoatedVal]
        );
      }
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to save streamer deployments");
    }
  });

  router.delete("/api/projects/:id/streamer-deployments/:streamerId", authMiddleware, superUserOnly, async (req, res) => {
    try {
      const id = requireValidId(req, res);
      if (id === null) return;

      const project = await getAsync("SELECT * FROM projects WHERE id = ?", [id]);
      if (!project) return sendError(res, 404, "Project not found");
      if (req.vesselScope && project.vessel_tag !== req.vesselScope) {
        return sendError(res, 403, "Cannot clear deployments for project from another vessel");
      }

      const streamerId = toInt(req.params.streamerId, NaN);
      if (Number.isNaN(streamerId)) return sendError(res, 400, "Invalid streamer ID");

      await runAsync("DELETE FROM streamer_deployments WHERE project_id = ? AND streamer_id = ?", [id, streamerId]);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to delete streamer deployment");
    }
  });

  router.post("/api/cleanup-streamers", authMiddleware, superUserOnly, async (req, res) => {
    try {
      // Cleanup across all projects/streamers is a global operation.
      if (!isGlobalUser(req.user)) {
        return sendError(res, 403, "Grand SuperUser access required to cleanup orphaned streamers");
      }

      const { maxStreamerId } = req.body;
      const id = typeof maxStreamerId === "number" ? maxStreamerId : parseInt(maxStreamerId, 10);
      if (Number.isNaN(id) || id < 1) return sendError(res, 400, "Invalid maxStreamerId");

      const eventsResult = await runAsync("DELETE FROM cleaning_events WHERE streamer_id > ?", [id]);
      const deploymentsResult = await runAsync("DELETE FROM streamer_deployments WHERE streamer_id > ?", [id]);
      res.json({
        success: true,
        deletedEvents: eventsResult.changes,
        deletedDeployments: deploymentsResult.changes,
      });
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to cleanup streamers");
    }
  });

  return router;
}

module.exports = { createProjectsRouter };
