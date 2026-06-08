// routes/stats.js
const express = require("express");
const { getAsync, getAllCamelized, getOneCamelized } = require("../db");
const { loadConfig, defaultConfig } = require("../config");
const { getActiveProjectForVessel } = require("../activeProject");
const { toInt } = require("../utils/validation");
const { sendError } = require("../utils/errors");
const { buildEventsWhereClause } = require("../utils/queryHelpers");
const { calculateEBRange } = require("../utils/eb");
const {
  expandEventsToSectionKeys,
  buildNoiseMap,
  computeNoiseEfficiency,
  computeNoiseEfficiencyByRange,
} = require("../utils/cleaningNoiseEfficiency");
const { buildNoiseRmsHistory } = require("../utils/noiseRmsHistory");

/**
 * Build a per-streamer effective sections map for a project, using the project default
 * for any streamer that does not have a specific override in streamer_deployments.
 * @param {number|null} projectId
 * @param {number} numCables
 * @param {number} defaultSections
 * @returns {Promise<Object>} e.g. { 1: 107, 2: 107, 3: 120, ... }
 */
async function buildSectionsPerCableMap(projectId, numCables, defaultSections) {
  const map = {};
  for (let i = 1; i <= numCables; i++) {
    map[i] = defaultSections;
  }
  if (projectId == null) return map;
  const overrides = await getAllCamelized(
    "SELECT streamer_id, sections_per_cable FROM streamer_deployments WHERE project_id = ? AND sections_per_cable IS NOT NULL",
    [projectId]
  );
  for (const row of overrides) {
    if (map[row.streamerId] !== undefined) {
      map[row.streamerId] = row.sectionsPerCable;
    }
  }
  return map;
}

/**
 * Resolve config for stats/last-cleaned: when project is in query or default vessel has active project, use that project's sectionsPerCable and useRopeForTail.
 * Also resolves a per-streamer sectionsPerCableMap for endpoints that need per-cable sizes.
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
  const numCables = projectRow?.numCables ?? config.numCables;
  const sectionsPerCable = projectRow?.sectionsPerCable ?? config.sectionsPerCable;
  const sectionsPerCableMap = await buildSectionsPerCableMap(projectRow?.id ?? null, numCables, sectionsPerCable);
  return {
    ...config,
    numCables,
    sectionsPerCable,
    useRopeForTail: projectRow != null ? projectRow.useRopeForTail === 1 : config.useRopeForTail,
    sectionLength: projectRow?.sectionLength ?? config.sectionLength,
    sectionsPerCableMap,
  };
}

/**
 * Create stats router (stats, last-cleaned, stats/filter, eb-range).
 * @param {function} authMiddleware
 * @returns {express.Router}
 */
function createStatsRouter(authMiddleware) {
  const router = express.Router();

  router.get("/api/eb-range", authMiddleware, async (req, res) => {
    try {
      const startSection = toInt(req.query.start, NaN);
      const endSection = toInt(req.query.end, NaN);
      const sectionType = req.query.sectionType;
      if (Number.isNaN(startSection) || Number.isNaN(endSection)) {
        return sendError(res, 400, "start and end query params required");
      }
      const config = await getEffectiveConfig(req);
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
      const tailSections = config.useRopeForTail ? 0 : 5;
      const sectionsPerCableMap = config.sectionsPerCableMap;
      // Sum effective sections across all streamers
      const totalAvailableSections = Object.values(sectionsPerCableMap).reduce((a, b) => a + b, 0);
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
        // Use the streamer's effective sections as tail base offset to keep keys globally unique
        const effectiveSections = sectionsPerCableMap[evt.streamerId] ?? config.sectionsPerCable;
        const base = isTail ? effectiveSections : 0;
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
      const cableCount = config.numCables;
      const tailSections = config.useRopeForTail ? 0 : 5;
      const sectionsPerCableMap = config.sectionsPerCableMap;

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
        const effectiveSections = sectionsPerCableMap[streamerId] ?? config.sectionsPerCable;
        map[streamerId] = Array(effectiveSections + tailSections).fill(null);
      }
      for (const r of rows) {
        const arr = map[r.streamerId];
        if (!arr) continue;
        const effectiveSections = sectionsPerCableMap[r.streamerId] ?? config.sectionsPerCable;
        const base = r.sectionType === "tail" ? effectiveSections : 0;
        const totalSections = effectiveSections + tailSections;
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
      const cableCount = config.numCables;
      const tailSections = config.useRopeForTail ? 0 : 5;
      const sectionsPerCableMap = config.sectionsPerCableMap;

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
        const effectiveSections = sectionsPerCableMap[streamerId] ?? config.sectionsPerCable;
        map[streamerId] = Array(effectiveSections + tailSections).fill(null);
      }
      for (const r of rows) {
        const arr = map[r.streamerId];
        if (!arr) continue;
        const effectiveSections = sectionsPerCableMap[r.streamerId] ?? config.sectionsPerCable;
        const base = r.sectionType === "tail" ? effectiveSections : 0;
        const totalSections = effectiveSections + tailSections;
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
      const sectionsPerCableMap = config.sectionsPerCableMap;

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
        const effectiveSections = sectionsPerCableMap[r.streamerId] ?? config.sectionsPerCable;
        const base = isTail ? effectiveSections : 0;
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

  /**
   * GET /api/stats/cleaning-noise-efficiency
   *
   * Compares RMS noise between two noise uploads for sections that were
   * cleaned in a given date window. Only active-type events contribute;
   * tail events do not appear in noise CSVs and are excluded.
   *
   * Query params:
   *   project        - required; project_number to scope events and uploads
   *   uploadBeforeId - optional int; defaults to second-latest upload for the project
   *   uploadAfterId  - optional int; defaults to latest upload for the project
   *   start          - optional ISO date (YYYY-MM-DD); lower bound for cleaned_at
   *   end            - optional ISO date (YYYY-MM-DD); upper bound for cleaned_at
   */
  router.get("/api/stats/cleaning-noise-efficiency", authMiddleware, async (req, res) => {
    try {
      const { project, start, end } = req.query;
      const uploadBeforeId = toInt(req.query.uploadBeforeId, NaN);
      const uploadAfterId = toInt(req.query.uploadAfterId, NaN);

      if (!project) {
        return sendError(res, 400, "project query param is required");
      }

      // Verify project exists and apply vessel scope
      const projectRow = await getOneCamelized(
        "SELECT project_number, vessel_tag FROM projects WHERE project_number = ?",
        [project]
      );
      if (!projectRow) {
        return sendError(res, 404, `Project ${project} not found`);
      }
      if (req.vesselScope && projectRow.vesselTag !== req.vesselScope) {
        return sendError(res, 403, "Project does not belong to your vessel");
      }

      // Build scoped upload scope conditions
      const uploadConditions = ["project_number = ?"];
      const uploadScopeParams = [project];
      if (req.vesselScope) {
        uploadConditions.push("vessel_tag = ?");
        uploadScopeParams.push(req.vesselScope);
      }
      const uploadScopeWhere = " WHERE " + uploadConditions.join(" AND ");

      // Resolve the two upload rows, defaulting to latest and second-latest
      let uploadBefore, uploadAfter;

      if (!Number.isNaN(uploadBeforeId) && !Number.isNaN(uploadAfterId)) {
        // Both supplied explicitly
        [uploadBefore, uploadAfter] = await Promise.all([
          getOneCamelized(
            `SELECT id, uploaded_at, label FROM noise_uploads${uploadScopeWhere} AND id = ?`,
            [...uploadScopeParams, uploadBeforeId]
          ),
          getOneCamelized(
            `SELECT id, uploaded_at, label FROM noise_uploads${uploadScopeWhere} AND id = ?`,
            [...uploadScopeParams, uploadAfterId]
          ),
        ]);
        if (!uploadBefore) return sendError(res, 404, `Upload ${uploadBeforeId} not found for this project`);
        if (!uploadAfter) return sendError(res, 404, `Upload ${uploadAfterId} not found for this project`);
      } else {
        // Default: latest two uploads
        const latestTwo = await getAllCamelized(
          `SELECT id, uploaded_at, label FROM noise_uploads${uploadScopeWhere} ORDER BY uploaded_at DESC LIMIT 2`,
          uploadScopeParams
        );
        if (latestTwo.length < 2) {
          return res.json({
            status: "insufficient_uploads",
            message: "At least 2 noise uploads are required to compare. Upload a second noise file first.",
            cellsInEvents: 0,
            cellsPaired: 0,
            skippedMissing: 0,
            meanImprovementPct: null,
            medianImprovementPct: null,
            improvedCount: 0,
            improvedSharePct: null,
            meanRmsBefore: null,
            meanRmsAfter: null,
            uploadBefore: latestTwo[1] ?? null,
            uploadAfter: latestTwo[0] ?? null,
          });
        }
        // latestTwo[0] = newest (after), latestTwo[1] = older (before)
        uploadAfter = latestTwo[0];
        uploadBefore = latestTwo[1];
      }

      // Fetch active cleaning events in the date window
      const { sql: baseWhereSql, params: baseParams } = buildEventsWhereClause({
        project,
        start,
        end,
      });

      let eventWhere = baseWhereSql;
      const eventParams = [...baseParams];
      if (req.vesselScope) {
        eventWhere += eventWhere ? " AND vessel_tag = ?" : " WHERE vessel_tag = ?";
        eventParams.push(req.vesselScope);
      }

      // Only active events — tail sections are absent from noise CSVs
      const activeCondition = eventWhere ? " AND section_type = 'active'" : " WHERE section_type = 'active'";
      const eventSql =
        "SELECT id, streamer_id, section_index_start, section_index_end, section_type, cleaned_at, cleaning_method " +
        "FROM cleaning_events" +
        eventWhere +
        activeCondition +
        " ORDER BY datetime(cleaned_at) DESC";

      const cleaningEvents = await getAllCamelized(eventSql, eventParams);

      const sectionKeys = expandEventsToSectionKeys(cleaningEvents);

      if (sectionKeys.size === 0) {
        return res.json({
          status: "no_events",
          message: "No active cleaning events found in the selected date window.",
          cellsInEvents: 0,
          cellsPaired: 0,
          skippedMissing: 0,
          meanImprovementPct: null,
          medianImprovementPct: null,
          improvedCount: 0,
          improvedSharePct: null,
          meanRmsBefore: null,
          meanRmsAfter: null,
          uploadBefore: { id: uploadBefore.id, uploadedAt: uploadBefore.uploadedAt, label: uploadBefore.label },
          uploadAfter: { id: uploadAfter.id, uploadedAt: uploadAfter.uploadedAt, label: uploadAfter.label },
        });
      }

      // Fetch noise data for both uploads in one query, split in memory
      const noiseRows = await getAllCamelized(
        "SELECT upload_id, cable_number, section_number, rms_value FROM noise_data WHERE upload_id IN (?, ?)",
        [uploadBefore.id, uploadAfter.id]
      );

      const rowsBefore = noiseRows.filter((r) => r.uploadId === uploadBefore.id);
      const rowsAfter = noiseRows.filter((r) => r.uploadId === uploadAfter.id);

      const noiseMapBefore = buildNoiseMap(rowsBefore);
      const noiseMapAfter = buildNoiseMap(rowsAfter);

      const kpi = computeNoiseEfficiency(sectionKeys, noiseMapBefore, noiseMapAfter);
      const ranges = computeNoiseEfficiencyByRange(cleaningEvents, noiseMapBefore, noiseMapAfter);

      res.json({
        status: "ok",
        ...kpi,
        ranges,
        uploadBefore: { id: uploadBefore.id, uploadedAt: uploadBefore.uploadedAt, label: uploadBefore.label },
        uploadAfter: { id: uploadAfter.id, uploadedAt: uploadAfter.uploadedAt, label: uploadAfter.label },
      });
    } catch (err) {
      console.error("GET /api/stats/cleaning-noise-efficiency failed", err);
      sendError(res, 500, "Failed to compute cleaning noise efficiency");
    }
  });

  /**
   * GET /api/stats/noise-rms-history
   *
   * Returns average RMS per streamer for each noise upload batch on a project,
   * averaged over all active sections with positive RMS in that upload.
   * Uploads are ordered oldest → newest for trend charts.
   *
   * Query params:
   *   project - required project_number
   */
  router.get("/api/stats/noise-rms-history", authMiddleware, async (req, res) => {
    try {
      const { project } = req.query;
      if (!project) {
        return sendError(res, 400, "project query param is required");
      }

      const projectRow = await getOneCamelized(
        "SELECT id, project_number, vessel_tag, num_cables, sections_per_cable FROM projects WHERE project_number = ?",
        [project]
      );
      if (!projectRow) {
        return sendError(res, 404, `Project ${project} not found`);
      }
      if (req.vesselScope && projectRow.vesselTag !== req.vesselScope) {
        return sendError(res, 403, "Project does not belong to your vessel");
      }

      const config = await loadConfig();
      const numCables = projectRow.numCables ?? config.numCables;
      const defaultSections = projectRow.sectionsPerCable ?? config.sectionsPerCable;
      const sectionsPerCableMap = await buildSectionsPerCableMap(
        projectRow.id,
        numCables,
        defaultSections
      );

      const uploadConditions = ["project_number = ?"];
      const uploadParams = [project];
      if (req.vesselScope) {
        uploadConditions.push("vessel_tag = ?");
        uploadParams.push(req.vesselScope);
      }
      const uploadWhere = uploadConditions.join(" AND ");

      const uploads = await getAllCamelized(
        `SELECT id, uploaded_at, label, water_speed_start, water_speed_end FROM noise_uploads WHERE ${uploadWhere} ORDER BY uploaded_at ASC`,
        uploadParams
      );

      if (uploads.length === 0) {
        return res.json({ uploads: [], streamers: [], waterSpeedAvg: [] });
      }

      const uploadIds = uploads.map((u) => u.id);
      const placeholders = uploadIds.map(() => "?").join(", ");
      const noiseRows = await getAllCamelized(
        `SELECT upload_id, cable_number, section_number, rms_value FROM noise_data WHERE upload_id IN (${placeholders})`,
        uploadIds
      );

      const history = buildNoiseRmsHistory(uploads, noiseRows, sectionsPerCableMap, numCables);
      res.json(history);
    } catch (err) {
      console.error("GET /api/stats/noise-rms-history failed", err);
      sendError(res, 500, "Failed to fetch noise RMS history");
    }
  });

  return router;
}

module.exports = { createStatsRouter };
