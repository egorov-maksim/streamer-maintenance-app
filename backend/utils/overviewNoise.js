// utils/overviewNoise.js
// Noise and cleaning-efficiency figures for the supervisor fleet overview. Pure logic.
const { buildNoiseRmsHistory } = require("./noiseRmsHistory");
const { buildNoiseMap, expandEventsToSectionKeys, computeNoiseEfficiency } = require("./cleaningNoiseEfficiency");
const { assessCleaningPeriod, toIsoUtc } = require("./noiseUploadTime");
const { kpi } = require("./overviewPeriods");

const round2 = (n) => Math.round(n * 100) / 100;

/** Mean of the non-null values (2 decimals), or null when there are none. */
function meanOf(values) {
  const present = values.filter((v) => v !== null && v !== undefined);
  if (present.length === 0) return null;
  return round2(present.reduce((a, b) => a + b, 0) / present.length);
}

/** Epoch ms of a stored timestamp; SQLite "YYYY-MM-DD HH:MM:SS" is read as UTC. */
function instant(value) {
  const iso = toIsoUtc(value);
  return iso === null ? NaN : Date.parse(iso);
}

/**
 * Noise KPIs of a project: latest and previous average RMS, worst streamers and the RMS trend.
 * @param {Array<{ id: number, measuredAt: string }>} uploads oldest first
 * @param {Array<{ uploadId: number, cableNumber: number, sectionNumber: number, rmsValue: number }>} noiseRows
 * @param {Object<number, number>} sectionsPerCableMap
 * @param {number} numCables
 * @param {string} windowStart ISO, inclusive
 * @param {string} windowEnd ISO, exclusive
 * @returns {{ latestAvgRms: number|null, previousAvgRms: number|null, deltaPct: number|null, uploadsInWindow: number,
 *   worstStreamers: Array<{ streamerId: number, avgRms: number }>,
 *   rmsHistory: Array<{ uploadId: number, measuredAt: string, avgRms: number|null }> }}
 */
function buildNoiseOverview(uploads, noiseRows, sectionsPerCableMap, numCables, windowStart, windowEnd) {
  const history = buildNoiseRmsHistory(uploads, noiseRows, sectionsPerCableMap, numCables);
  const rmsHistory = uploads.map((upload, i) => ({
    uploadId: upload.id,
    measuredAt: upload.measuredAt,
    avgRms: meanOf(history.streamers.map((s) => s.avgRms[i])),
  }));

  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);
  const times = uploads.map((u) => instant(u.measuredAt));
  const uploadsInWindow = times.filter((t) => t >= startMs && t < endMs).length;

  const latestIdx = uploads.length - 1;
  let previousAvgRms = null;
  for (let i = latestIdx - 1; i >= 0; i--) {
    if (times[i] < startMs) {
      previousAvgRms = rmsHistory[i].avgRms;
      break;
    }
  }
  const latestAvgRms = latestIdx >= 0 ? rmsHistory[latestIdx].avgRms : null;

  const worstStreamers =
    latestIdx < 0
      ? []
      : history.streamers
          .map((s) => ({ streamerId: s.streamerId, avgRms: s.avgRms[latestIdx] }))
          .filter((s) => s.avgRms !== null)
          .sort((a, b) => b.avgRms - a.avgRms || a.streamerId - b.streamerId)
          .slice(0, 5);

  return {
    latestAvgRms,
    previousAvgRms,
    deltaPct: kpi(latestAvgRms, previousAvgRms).deltaPct,
    uploadsInWindow,
    worstStreamers,
    rmsHistory,
  };
}

/**
 * Cleaning efficiency of consecutive upload pairs (newest `maxPairs`, oldest first). Only the
 * active events that fall between the two uploads count.
 * @param {Array<{ id: number, measuredAt: string }>} uploads oldest first, with measuredAt / timeSource
 * @param {Map<number, Array>} rowsByUploadId noise_data rows (camelized) per upload id
 * @param {Array<{ id: number, streamerId: number, sectionIndexStart: number, sectionIndexEnd: number, sectionType: string, cleanedAt: string }>} activeEvents
 * @param {number} [maxPairs]
 */
function buildEfficiencyPairs(uploads, rowsByUploadId, activeEvents, maxPairs = 8) {
  const pairs = [];
  for (let i = 1; i < uploads.length; i++) {
    const before = uploads[i - 1];
    const after = uploads[i];
    const { periodByEventId } = assessCleaningPeriod(before, after, activeEvents);
    const inside = activeEvents.filter((e) => periodByEventId.get(e.id) === "inside");
    const result = computeNoiseEfficiency(
      expandEventsToSectionKeys(inside),
      buildNoiseMap(rowsByUploadId.get(before.id) || []),
      buildNoiseMap(rowsByUploadId.get(after.id) || [])
    );
    pairs.push({
      beforeUploadId: before.id,
      afterUploadId: after.id,
      beforeMeasuredAt: before.measuredAt,
      afterMeasuredAt: after.measuredAt,
      meanImprovementPct: result.meanImprovementPct,
      improvedSharePct: result.improvedSharePct,
      cellsPaired: result.cellsPaired,
    });
  }
  return pairs.slice(-maxPairs);
}

module.exports = { buildNoiseOverview, buildEfficiencyPairs };
