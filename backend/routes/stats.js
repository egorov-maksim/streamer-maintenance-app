// routes/stats.js
const express = require("express");
const { getAsync, getAllCamelized, getOneCamelized } = require("../db");
const { loadConfig, defaultConfig } = require("../config");
const { getActiveProjectForVessel } = require("../activeProject");
const { toInt } = require("../utils/validation");
const { sendError } = require("../utils/errors");
const { buildEventsWhereClause } = require("../utils/queryHelpers");
const { calculateEBRange } = require("../utils/eb");

/**
 * Resolve config for stats/last-cleaned: when project is in query or default vessel has active project, use that project's sectionsPerCable and useRopeForTail.
 */
async function getEffectiveConfig(req) {
  const config = await loadConfig();
  const project = req.query?.project;
  const vesselTag = req.vesselScope || config.vesselTag || defaultConfig.vesselTag;
  let projectRow = null;
  if (project) {
    projectRow = await getOneCamelized("SELECT * FROM projects WHERE project_number = ?", [project]);
  } else {
    projectRow = await getActiveProjectForVessel(vesselTag);
  }
  return {
    ...config,
    numCables: projectRow?.numCables ?? config.numCables,
    sectionsPerCable: projectRow?.sectionsPerCable ?? config.sectionsPerCable,
    useRopeForTail: projectRow != null ? projectRow.useRopeForTail === 1 : config.useRopeForTail,
    sectionLength: projectRow?.sectionLength ?? config.sectionLength,
  };
}

/**
 * Create stats router (stats, last-cleaned, stats/filter, eb-range).
 * @param {function} authMiddleware
 * @returns {express.Router}
 */
function createStatsRouter(authMiddleware) {
  const router = express.Router();

  router.get("/api/eb-range", async (req, res) => {
    try {
      const startSection = toInt(req.query.start, NaN);
      const endSection = toInt(req.query.end, NaN);
      const sectionType = req.query.sectionType;
      if (Number.isNaN(startSection) || Number.isNaN(endSection)) {
        return sendError(res, 400, "start and end query params required");
      }
      const config = await loadConfig();
      const sectionsPerCable = config.sectionsPerCable ?? 107;
      const isTail =
        sectionType === "tail" ||
        (startSection >= sectionsPerCable && endSection >= sectionsPerCable);
      if (isTail) {
        return res.json({ ebRange: "—" });
      }
      const ebRange = calculateEBRange(startSection, endSection, config);
      res.json({ ebRange });
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to calculate EB range");
    }
  });

  router.get("/api/stats", authMiddleware, async (req, res) => {
    try {
      const { project } = req.query;
      const config = await getEffectiveConfig(req);
      const sectionLength = config.sectionLength || 1;
      const sectionsPerCable = config.sectionsPerCable;
      const tailSections = config.useRopeForTail ? 0 : 5;
      const totalAvailableSections = config.numCables * sectionsPerCable;
      const totalAvailableTail = config.numCables * tailSections;

      let whereClause = "";
      const params = [];
      if (project) {
        whereClause = " WHERE project_number = ?";
        params.push(project);
      }
      if (req.vesselScope) {
        whereClause += whereClause ? " AND vessel_tag = ?" : " WHERE vessel_tag = ?";
        params.push(req.vesselScope);
      }

      const totalEvents = await getAsync(
        `SELECT COUNT(*) as count FROM cleaning_events${whereClause}`,
        params
      );
      const totals = await getAsync(
        `SELECT SUM(section_index_end - section_index_start + 1) as totalSections FROM cleaning_events${whereClause}`,
        params
      );

      const totalSectionsCleaned = totals?.totalSections || 0;
      const totalDistance = totalSectionsCleaned * sectionLength;

      const allEvents = await getAllCamelized(
        `SELECT streamer_id, section_index_start, section_index_end, section_type FROM cleaning_events${whereClause}`,
        params
      );
      const uniqueSections = new Set();
      const uniqueActiveSections = new Set();
      const uniqueTailSections = new Set();
      for (const evt of allEvents) {
        const isTail = evt.sectionType === "tail";
        const base = isTail ? sectionsPerCable : 0;
        for (let s = evt.sectionIndexStart; s <= evt.sectionIndexEnd; s++) {
          const globalIdx = base + s;
          uniqueSections.add(`${evt.streamerId}-${globalIdx}`);
          if (isTail) {
            uniqueTailSections.add(`${evt.streamerId}-${globalIdx}`);
          } else {
            uniqueActiveSections.add(`${evt.streamerId}-${globalIdx}`);
          }
        }
      }

      res.json({
        totalEvents: totalEvents.count,
        totalSections: totalSectionsCleaned,
        totalDistance,
        uniqueCleanedSections: uniqueSections.size,
        activeCleanedSections: uniqueActiveSections.size,
        tailCleanedSections: uniqueTailSections.size,
        totalAvailableSections,
        totalAvailableTail,
      });
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to get stats");
    }
  });

  router.get("/api/last-cleaned", authMiddleware, async (req, res) => {
    try {
      const { project } = req.query;
      const config = await getEffectiveConfig(req);
      const sectionsPerCable = config.sectionsPerCable;
      const cableCount = config.numCables;
      const tailSections = config.useRopeForTail ? 0 : 5;
      const totalSections = sectionsPerCable + tailSections;

      let sql = `SELECT streamer_id, section_index_start, section_index_end, section_type, cleaned_at FROM cleaning_events`;
      const params = [];
      const conditions = [];
      if (project) {
        conditions.push("project_number = ?");
        params.push(project);
      }
      if (req.vesselScope) {
        conditions.push("vessel_tag = ?");
        params.push(req.vesselScope);
      }
      if (conditions.length > 0) {
        sql += " WHERE " + conditions.join(" AND ");
      }
      sql += " ORDER BY datetime(cleaned_at) DESC";
      const rows = await getAllCamelized(sql, params);

      const map = {};
      for (let streamerId = 1; streamerId <= cableCount; streamerId++) {
        map[streamerId] = Array(totalSections).fill(null);
      }
      for (const r of rows) {
        const arr = map[r.streamerId];
        if (!arr) continue;
        const base = r.sectionType === "tail" ? sectionsPerCable : 0;
        for (let s = r.sectionIndexStart; s <= r.sectionIndexEnd; s++) {
          const idx = base + s;
          if (idx < totalSections && !arr[idx]) arr[idx] = r.cleanedAt;
        }
      }
      res.json({ lastCleaned: map });
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to compute last-cleaned");
    }
  });

  router.get("/api/last-cleaned-filtered", authMiddleware, async (req, res) => {
    try {
      const { start, end, project } = req.query;
      const config = await getEffectiveConfig(req);
      const sectionsPerCable = config.sectionsPerCable;
      const cableCount = config.numCables;
      const tailSections = config.useRopeForTail ? 0 : 5;
      const totalSections = sectionsPerCable + tailSections;

      const { sql: baseWhereSql, params: baseParams } = buildEventsWhereClause({
        project,
        start,
        end,
      });

      let whereSql = baseWhereSql;
      const whereParams = [...baseParams];
      if (req.vesselScope) {
        if (!whereSql) {
          whereSql = " WHERE vessel_tag = ?";
        } else {
          whereSql += " AND vessel_tag = ?";
        }
        whereParams.push(req.vesselScope);
      }
      const sql =
        `SELECT streamer_id, section_index_start, section_index_end, section_type, cleaned_at FROM cleaning_events` +
        whereSql +
        " ORDER BY datetime(cleaned_at) DESC";
      const rows = await getAllCamelized(sql, whereParams);

      const map = {};
      for (let streamerId = 1; streamerId <= cableCount; streamerId++) {
        map[streamerId] = Array(totalSections).fill(null);
      }
      for (const r of rows) {
        const arr = map[r.streamerId];
        if (!arr) continue;
        const base = r.sectionType === "tail" ? sectionsPerCable : 0;
        for (let s = r.sectionIndexStart; s <= r.sectionIndexEnd; s++) {
          const idx = base + s;
          if (idx < totalSections && !arr[idx]) arr[idx] = r.cleanedAt;
        }
      }
      res.json({ lastCleaned: map });
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to compute filtered last-cleaned");
    }
  });

  router.get("/api/stats/filter", authMiddleware, async (req, res) => {
    try {
      const { start, end, project } = req.query;
      const config = await getEffectiveConfig(req);
      const sectionLength = config.sectionLength || 1;
      const sectionsPerCable = config.sectionsPerCable;

      const { sql: baseWhereSql, params: baseParams } = buildEventsWhereClause({
        project,
        start,
        end,
      });

      let whereSql = baseWhereSql;
      const whereParams = [...baseParams];
      if (req.vesselScope) {
        if (!whereSql) {
          whereSql = " WHERE vessel_tag = ?";
        } else {
          whereSql += " AND vessel_tag = ?";
        }
        whereParams.push(req.vesselScope);
      }

      const sql =
        "SELECT * FROM cleaning_events" + whereSql + " ORDER BY datetime(cleaned_at) DESC";
      const rows = await getAllCamelized(sql, whereParams);

      const totalSectionsCleaned = rows.reduce(
        (acc, r) => acc + (r.sectionIndexEnd - r.sectionIndexStart + 1),
        0
      );
      const totalDistance = totalSectionsCleaned * sectionLength;
      const lastCleaning = rows[0]?.cleanedAt || null;

      const uniqueSections = new Set();
      const uniqueActiveSections = new Set();
      const uniqueTailSections = new Set();
      const byMethod = {};
      for (const r of rows) {
        const len = (r.sectionIndexEnd - r.sectionIndexStart + 1) * sectionLength;
        byMethod[r.cleaningMethod] = (byMethod[r.cleaningMethod] || 0) + len;
        const isTail = r.sectionType === "tail";
        const base = isTail ? sectionsPerCable : 0;
        for (let s = r.sectionIndexStart; s <= r.sectionIndexEnd; s++) {
          const globalIdx = base + s;
          uniqueSections.add(`${r.streamerId}-${globalIdx}`);
          if (isTail) {
            uniqueTailSections.add(`${r.streamerId}-${globalIdx}`);
          } else {
            uniqueActiveSections.add(`${r.streamerId}-${globalIdx}`);
          }
        }
      }
      res.json({
        events: rows.length,
        totalDistance,
        lastCleaning,
        byMethod,
        uniqueCleanedSections: uniqueSections.size,
        activeCleanedSections: uniqueActiveSections.size,
        tailCleanedSections: uniqueTailSections.size,
      });
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to get filtered stats");
    }
  });

  return router;
}

module.exports = { createStatsRouter };
