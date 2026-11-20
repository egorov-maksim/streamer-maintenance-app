// routes/overview.js
// Read-only fleet overview for supervisors (and the grand superuser).
const express = require("express");
const { getAsync, getAllCamelized } = require("../db");
const { getActiveProjectForVessel } = require("../activeProject");
const { requireRole, ROLES } = require("../middleware/auth");
const { resolveEffectiveConfig } = require("../utils/effectiveConfig");
const { summarizeSectionCoverage } = require("../utils/cleanedSections");
const { parseDays, buildPeriods, kpi, deltaPoints } = require("../utils/overviewPeriods");
const { buildNoiseOverview, buildEfficiencyPairs } = require("../utils/overviewNoise");
const { MEASURED_AT_SQL, withMeasuredAt, assessCleaningPeriod } = require("../utils/noiseUploadTime");
const { sendError, httpError, handleRouteError } = require("../utils/errors");

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_THRESHOLD_DAYS = 10;

const WINDOW_SQL = "datetime(e.cleaned_at) >= datetime(?) AND datetime(e.cleaned_at) < datetime(?)";
const METERS_SQL = "(e.section_index_end - e.section_index_start + 1) * COALESCE(p.section_length, 75)";

/** Events and distance (km) of all the vessel's projects within [from, to). */
async function windowTotals(vessel, from, to) {
  const row = await getAsync(
    `SELECT COUNT(*) AS events, COALESCE(SUM(${METERS_SQL}), 0) AS meters
       FROM cleaning_events e JOIN projects p ON p.project_number = e.project_number
      WHERE p.vessel_tag = ? AND ${WINDOW_SQL}`,
    [vessel, from, to]
  );
  return { events: row.events, km: row.meters / 1000 };
}

const MAX_PAIRS = 8;

const startOfUtcDay = (ms) => Math.floor(ms / DAY_MS) * DAY_MS;

/** Whole UTC days from `thenMs` to `nowMs` (0 = same UTC day), never negative. */
const wholeUtcDaysSince = (thenMs, nowMs) =>
  Math.max(0, Math.round((startOfUtcDay(nowMs) - startOfUtcDay(thenMs)) / DAY_MS));

const NO_PAIR_FIGURES = { meanImprovementPct: null, improvedSharePct: null };

/**
 * Noise block, efficiency block and freshness of the active project's noise uploads.
 * @returns {Promise<{ noise: Object, efficiency: Object, lastNoiseUploadAt: string|null, daysSinceLastNoiseUpload: number|null }>}
 */
async function loadNoiseAndEfficiency({ project, vessel, config, start, end, now, distancePerCleaningDayKm }) {
  const uploads = (
    await getAllCamelized(
      `SELECT id, uploaded_at, recorded_at, label FROM noise_uploads
        WHERE project_number = ? AND vessel_tag = ? ORDER BY ${MEASURED_AT_SQL} ASC, id ASC`,
      [project.projectNumber, vessel]
    )
  ).map(withMeasuredAt);

  const latest = uploads[uploads.length - 1];
  const latestMs = latest ? Date.parse(latest.measuredAt) : NaN;
  const hasLatest = !Number.isNaN(latestMs);

  // One query for every upload; only active-section cells are needed (the history ignores the rest).
  let noiseRows = [];
  if (uploads.length > 0) {
    const maxSection = Math.max(0, ...Object.values(config.sectionsPerCableMap));
    const ids = uploads.map((u) => u.id);
    noiseRows = await getAllCamelized(
      `SELECT upload_id, cable_number, section_number, rms_value FROM noise_data
        WHERE upload_id IN (${ids.map(() => "?").join(", ")}) AND section_number BETWEEN 1 AND ?`,
      [...ids, maxSection]
    );
  }
  const noise = buildNoiseOverview(uploads, noiseRows, config.sectionsPerCableMap, config.numCables, start, end);

  const base = { ...NO_PAIR_FIGURES, distancePerCleaningDayKm, pairs: [] };
  let efficiency;
  if (uploads.length < 2) {
    efficiency = {
      status: "insufficient_uploads",
      reason: "At least 2 noise uploads are needed to measure the effect of cleaning.",
      ...base,
    };
  } else {
    const pairUploads = uploads.slice(-(MAX_PAIRS + 1));
    const rowsByUploadId = new Map();
    for (const row of noiseRows) {
      if (!rowsByUploadId.has(row.uploadId)) rowsByUploadId.set(row.uploadId, []);
      rowsByUploadId.get(row.uploadId).push(row);
    }
    const events = await getAllCamelized(
      `SELECT id, streamer_id, section_index_start, section_index_end, section_type, cleaned_at, cleaning_method
         FROM cleaning_events WHERE project_number = ? AND section_type = 'active'`,
      [project.projectNumber]
    );
    const pairs = buildEfficiencyPairs(pairUploads, rowsByUploadId, events, MAX_PAIRS);
    const newest = pairs[pairs.length - 1];
    const { periodByEventId } = assessCleaningPeriod(pairUploads[pairUploads.length - 2], pairUploads[pairUploads.length - 1], events);
    const cleanedInside = [...periodByEventId.values()].some((p) => p === "inside");
    efficiency = cleanedInside
      ? {
          status: "ok",
          reason: null,
          meanImprovementPct: newest.meanImprovementPct,
          improvedSharePct: newest.improvedSharePct,
          distancePerCleaningDayKm,
          pairs,
        }
      : {
          status: "no_events",
          reason: "No cleaning was logged between the two newest noise uploads.",
          ...base,
          pairs,
        };
  }

  return {
    noise,
    efficiency,
    lastNoiseUploadAt: hasLatest ? latest.measuredAt : null,
    daysSinceLastNoiseUpload: hasLatest ? wholeUtcDaysSince(latestMs, now.getTime()) : null,
  };
}

function createOverviewRouter(authMiddleware) {
  const router = express.Router();
  const guard = requireRole([ROLES.SUPERVISOR, ROLES.GRAND_SUPER_USER]);

  router.get("/api/overview/vessels", authMiddleware, guard, async (_req, res) => {
    try {
      const rows = await getAllCamelized(
        "SELECT DISTINCT vessel_tag FROM projects WHERE vessel_tag IS NOT NULL ORDER BY vessel_tag"
      );
      res.json({ vessels: rows.map((r) => r.vesselTag) });
    } catch (err) {
      handleRouteError(res, err, "Failed to load vessels");
    }
  });

  router.get("/api/overview", authMiddleware, guard, async (req, res) => {
    try {
      const vessel = typeof req.query.vessel === "string" ? req.query.vessel.trim() : "";
      if (!vessel) throw httpError(400, "vessel is required");
      const days = parseDays(req.query.days);
      if (days === null) throw httpError(400, "days must be 7, 30 or 90");
      const known = await getAsync("SELECT 1 AS ok FROM projects WHERE vessel_tag = ? LIMIT 1", [vessel]);
      if (!known) throw httpError(404, "Unknown vessel");

      const now = new Date();
      const { start, end, prevStart } = buildPeriods(days, now);

      const [cur, prev, daily, last, project] = await Promise.all([
        windowTotals(vessel, start, end),
        windowTotals(vessel, prevStart, start),
        getAllCamelized(
          `SELECT DATE(e.cleaned_at) AS date, SUM(${METERS_SQL}) AS meters
             FROM cleaning_events e JOIN projects p ON p.project_number = e.project_number
            WHERE p.vessel_tag = ? AND ${WINDOW_SQL}
            GROUP BY DATE(e.cleaned_at) ORDER BY date ASC`,
          [vessel, start, end]
        ),
        getAsync(
          `SELECT e.cleaned_at AS cleanedAt
             FROM cleaning_events e JOIN projects p ON p.project_number = e.project_number
            WHERE p.vessel_tag = ? ORDER BY datetime(e.cleaned_at) DESC LIMIT 1`,
          [vessel]
        ),
        getActiveProjectForVessel(vessel),
      ]);

      let lastCleaningAt = null;
      let daysSinceLastCleaning = null;
      if (last && !Number.isNaN(Date.parse(last.cleanedAt))) {
        const lastMs = Date.parse(last.cleanedAt);
        lastCleaningAt = new Date(lastMs).toISOString();
        daysSinceLastCleaning = wholeUtcDaysSince(lastMs, now.getTime());
      }

      const distancePerCleaningDayKm = daily.length > 0 ? cur.km / daily.length : null;

      let coverage = null;
      let overdueSections = null;
      let noise = null;
      let efficiency = {
        status: "no_active_project",
        reason: "The vessel has no active project.",
        ...NO_PAIR_FIGURES,
        distancePerCleaningDayKm,
        pairs: [],
      };
      let lastNoiseUploadAt = null;
      let daysSinceLastNoiseUpload = null;
      if (project) {
        const config = await resolveEffectiveConfig({
          projectNumber: project.projectNumber,
          vesselTag: vessel,
          vesselScope: null,
        });
        const events = await getAllCamelized(
          `SELECT streamer_id, section_index_start, section_index_end, section_type, cleaned_at
             FROM cleaning_events WHERE project_number = ?`,
          [project.projectNumber]
        );
        const thresholdDays = project.suggestedCleaningThresholdDays ?? DEFAULT_THRESHOLD_DAYS;
        const s = summarizeSectionCoverage(events, config, {
          windowStart: start,
          now: now.toISOString(),
          thresholdDays,
        });
        coverage = {
          pct: s.coveragePct,
          atWindowStartPct: s.coverageAtStartPct,
          deltaPoints: deltaPoints(s.coveragePct, s.coverageAtStartPct),
          cleanedSections: s.cleanedSections,
          totalSections: s.totalSections,
        };
        overdueSections = { count: s.overdueSections, thresholdDays, totalActiveSections: s.totalActiveSections };
        ({ noise, efficiency, lastNoiseUploadAt, daysSinceLastNoiseUpload } = await loadNoiseAndEfficiency({
          project,
          vessel,
          config,
          start,
          end,
          now,
          distancePerCleaningDayKm,
        }));
      }

      res.json({
        vessel,
        days,
        generatedAt: now.toISOString(),
        project: project ? { projectNumber: project.projectNumber, projectName: project.projectName ?? null } : null,
        freshness: {
          lastCleaningAt,
          daysSinceLastCleaning,
          lastNoiseUploadAt,
          daysSinceLastNoiseUpload,
        },
        cleaning: {
          coverage,
          distanceKm: kpi(cur.km, prev.km),
          events: kpi(cur.events, prev.events),
          overdueSections,
          dailyDistanceKm: daily.map((d) => ({ date: d.date, km: d.meters / 1000 })),
        },
        noise,
        efficiency,
      });
    } catch (err) {
      handleRouteError(res, err, "Failed to load overview");
    }
  });

  return router;
}

module.exports = { createOverviewRouter };
