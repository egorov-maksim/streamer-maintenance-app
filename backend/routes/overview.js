// routes/overview.js
// Read-only fleet overview for supervisors (and the grand superuser).
const express = require("express");
const { getAsync, getAllCamelized } = require("../db");
const { getActiveProjectForVessel } = require("../activeProject");
const { requireRole, ROLES } = require("../middleware/auth");
const { resolveEffectiveConfig } = require("../utils/effectiveConfig");
const { summarizeSectionCoverage } = require("../utils/cleanedSections");
const { parseDays, buildPeriods, kpi, deltaPoints } = require("../utils/overviewPeriods");
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

const startOfUtcDay = (ms) => Math.floor(ms / DAY_MS) * DAY_MS;

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
        daysSinceLastCleaning = Math.max(0, Math.round((startOfUtcDay(now.getTime()) - startOfUtcDay(lastMs)) / DAY_MS));
      }

      let coverage = null;
      let overdueSections = null;
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
      }

      res.json({
        vessel,
        days,
        generatedAt: now.toISOString(),
        project: project ? { projectNumber: project.projectNumber, projectName: project.projectName ?? null } : null,
        freshness: {
          lastCleaningAt,
          daysSinceLastCleaning,
          lastNoiseUploadAt: null,
          daysSinceLastNoiseUpload: null,
        },
        cleaning: {
          coverage,
          distanceKm: kpi(cur.km, prev.km),
          events: kpi(cur.events, prev.events),
          overdueSections,
          dailyDistanceKm: daily.map((d) => ({ date: d.date, km: d.meters / 1000 })),
        },
      });
    } catch (err) {
      handleRouteError(res, err, "Failed to load overview");
    }
  });

  return router;
}

module.exports = { createOverviewRouter };
