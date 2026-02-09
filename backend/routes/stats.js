// routes/stats.js
const express = require("express");
const { getAsync, getAllCamelized } = require("../db");
const { loadConfig } = require("../config");
const { toInt } = require("../utils/validation");
const { sendError } = require("../utils/errors");
const { buildEventsWhereClause } = require("../utils/queryHelpers");
const { calculateEBRange } = require("../utils/eb");

/**
 * Create stats router (stats, last-cleaned, stats/filter, eb-range).
 * @returns {express.Router}
 */
function createStatsRouter() {
  const router = express.Router();

  router.get("/api/eb-range", async (req, res) => {
    try {
      const startSection = toInt(req.query.start, NaN);
      const endSection = toInt(req.query.end, NaN);
      if (Number.isNaN(startSection) || Number.isNaN(endSection)) {
        return sendError(res, 400, "start and end query params required");
      }
      const config = await loadConfig();
      const ebRange = calculateEBRange(startSection, endSection, config);
      res.json({ ebRange });
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to calculate EB range");
    }
  });

  router.get("/api/stats", async (req, res) => {
    try {
      const { project } = req.query;
      const config = await loadConfig();
      const sectionLength = config.sectionLength || 1;
      const N = config.sectionsPerCable;
      const tailSections = config.useRopeForTail ? 0 : 5;
      const totalAvailableSections = config.numCables * N;
      const totalAvailableTail = config.numCables * tailSections;

      let whereClause = "";
      const params = [];
      if (project) {
        whereClause = " WHERE project_number = ?";
        params.push(project);
      }

      const totalEvents = await getAsync(`SELECT COUNT(*) as count FROM cleaning_events${whereClause}`, params);
      const totals = await getAsync(
        `SELECT SUM(section_index_end - section_index_start + 1) as totalSections FROM cleaning_events${whereClause}`,
        params
      );

      const totalSectionsCleaned = totals?.totalSections || 0;
      const totalDistance = totalSectionsCleaned * sectionLength;

      const allEvents = await getAllCamelized(
        `SELECT streamer_id, section_index_start, section_index_end FROM cleaning_events${whereClause}`,
        params
      );
      const uniqueSections = new Set();
      const uniqueActiveSections = new Set();
      const uniqueTailSections = new Set();
      for (const evt of allEvents) {
        for (let s = evt.sectionIndexStart; s <= evt.sectionIndexEnd; s++) {
          uniqueSections.add(`${evt.streamerId}-${s}`);
          if (s < N) uniqueActiveSections.add(`${evt.streamerId}-${s}`);
          else uniqueTailSections.add(`${evt.streamerId}-${s}`);
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

  router.get("/api/last-cleaned", async (req, res) => {
    try {
      const { project } = req.query;
      const config = await loadConfig();
      const N = config.sectionsPerCable;
      const cableCount = config.numCables;
      const tailSections = config.useRopeForTail ? 0 : 5;
      const totalSections = N + tailSections;

      let sql = `SELECT streamer_id, section_index_start, section_index_end, cleaned_at FROM cleaning_events`;
      const params = [];
      if (project) {
        sql += " WHERE project_number = ?";
        params.push(project);
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
        for (let s = r.sectionIndexStart; s <= r.sectionIndexEnd && s < totalSections; s++) {
          if (!arr[s]) arr[s] = r.cleanedAt;
        }
      }
      res.json({ lastCleaned: map });
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to compute last-cleaned");
    }
  });

  router.get("/api/last-cleaned-filtered", async (req, res) => {
    try {
      const { start, end, project } = req.query;
      const config = await loadConfig();
      const N = config.sectionsPerCable;
      const cableCount = config.numCables;
      const tailSections = config.useRopeForTail ? 0 : 5;
      const totalSections = N + tailSections;

      const { sql: whereSql, params: whereParams } = buildEventsWhereClause({ project, start, end });
      const sql =
        `SELECT streamer_id, section_index_start, section_index_end, cleaned_at FROM cleaning_events` +
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
        for (let s = r.sectionIndexStart; s <= r.sectionIndexEnd && s < totalSections; s++) {
          if (!arr[s]) arr[s] = r.cleanedAt;
        }
      }
      res.json({ lastCleaned: map });
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to compute filtered last-cleaned");
    }
  });

  router.get("/api/stats/filter", async (req, res) => {
    try {
      const { start, end, project } = req.query;
      const config = await loadConfig();
      const sectionLength = config.sectionLength || 1;
      const N = config.sectionsPerCable;

      const { sql: whereSql, params: whereParams } = buildEventsWhereClause({ project, start, end });
      const sql = "SELECT * FROM cleaning_events" + whereSql + " ORDER BY datetime(cleaned_at) DESC";
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
        for (let s = r.sectionIndexStart; s <= r.sectionIndexEnd; s++) {
          uniqueSections.add(`${r.streamerId}-${s}`);
          if (s < N) uniqueActiveSections.add(`${r.streamerId}-${s}`);
          else uniqueTailSections.add(`${r.streamerId}-${s}`);
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
