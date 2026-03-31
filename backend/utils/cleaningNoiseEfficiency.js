// Computes per-section noise-improvement statistics for active-cable cleaning events.
// Pure logic only — no DB, no HTTP, so it can be unit-tested directly.

/**
 * Expands a list of active-section cleaning events into a deduplicated set of
 * (streamerId, sectionNumber) keys, where sectionNumber is 1-based (matching the
 * noise_data table convention).  Tail events are intentionally excluded because
 * noise CSVs only cover active sections.
 *
 * @param {Array<{ streamerId: number, sectionIndexStart: number, sectionIndexEnd: number, sectionType: string }>} events
 * @returns {Set<string>} keys of the form `"${streamerId}:${sectionNumber}"`
 */
function expandEventsToSectionKeys(events) {
  const keys = new Set();
  for (const evt of events) {
    if (evt.sectionType !== "active") continue;
    const start = Math.min(evt.sectionIndexStart, evt.sectionIndexEnd);
    const end = Math.max(evt.sectionIndexStart, evt.sectionIndexEnd);
    for (let idx = start; idx <= end; idx++) {
      // section_number in noise_data is 1-based; sectionIndexStart is 0-based.
      keys.add(`${evt.streamerId}:${idx + 1}`);
    }
  }
  return keys;
}

/**
 * Builds a lookup map from noise_data rows for fast O(1) access per cell.
 *
 * @param {Array<{ cableNumber: number, sectionNumber: number, rmsValue: number }>} rows
 * @returns {Map<string, number>} key `"${cableNumber}:${sectionNumber}"` → rmsValue
 */
function buildNoiseMap(rows) {
  const map = new Map();
  for (const row of rows) {
    map.set(`${row.cableNumber}:${row.sectionNumber}`, row.rmsValue);
  }
  return map;
}

/**
 * Computes cleaning noise efficiency aggregates for the cells identified by the
 * active-events set, comparing two noise snapshots (before vs after).
 *
 * A cell is included in the calculation only when:
 *  - its key appears in both noise maps (paired data), and
 *  - rmsBefore > 0 (avoid division by zero).
 *
 * Returns meaningful placeholders when there are no events or no paired data,
 * so the caller can still surface a clear UI message.
 *
 * @param {Set<string>} sectionKeys - deduplicated `"streamerId:sectionNumber"` keys from active events
 * @param {Map<string, number>} noiseMapBefore - RMS readings for the "before" upload
 * @param {Map<string, number>} noiseMapAfter - RMS readings for the "after" upload
 * @returns {{
 *   cellsInEvents: number,
 *   cellsPaired: number,
 *   skippedMissing: number,
 *   meanImprovementPct: number | null,
 *   medianImprovementPct: number | null,
 *   improvedCount: number,
 *   improvedSharePct: number | null,
 *   meanRmsBefore: number | null,
 *   meanRmsAfter: number | null,
 * }}
 */
function computeNoiseEfficiency(sectionKeys, noiseMapBefore, noiseMapAfter) {
  const improvements = [];
  let skippedMissing = 0;
  let sumBefore = 0;
  let sumAfter = 0;

  for (const key of sectionKeys) {
    const before = noiseMapBefore.get(key);
    const after = noiseMapAfter.get(key);

    if (before == null || after == null || before <= 0) {
      skippedMissing++;
      continue;
    }

    const pct = ((before - after) / before) * 100;
    improvements.push(pct);
    sumBefore += before;
    sumAfter += after;
  }

  const cellsPaired = improvements.length;
  const cellsInEvents = sectionKeys.size;

  if (cellsPaired === 0) {
    return {
      cellsInEvents,
      cellsPaired: 0,
      skippedMissing,
      meanImprovementPct: null,
      medianImprovementPct: null,
      improvedCount: 0,
      improvedSharePct: null,
      meanRmsBefore: null,
      meanRmsAfter: null,
    };
  }

  const mean = improvements.reduce((a, b) => a + b, 0) / cellsPaired;
  const sorted = [...improvements].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  const improvedCount = improvements.filter((p) => p > 0).length;

  return {
    cellsInEvents,
    cellsPaired,
    skippedMissing,
    meanImprovementPct: round2(mean),
    medianImprovementPct: round2(median),
    improvedCount,
    improvedSharePct: round2((improvedCount / cellsPaired) * 100),
    meanRmsBefore: round2(sumBefore / cellsPaired),
    meanRmsAfter: round2(sumAfter / cellsPaired),
  };
}

/**
 * Computes cleaning noise efficiency for each individual active cleaning event,
 * so operators can compare improvement per log entry rather than only as a whole.
 * Tail events are excluded because noise CSVs cover active sections only.
 *
 * Unlike `expandEventsToSectionKeys` + `computeNoiseEfficiency` (which deduplicates
 * across all events first), this function processes each event independently —
 * overlapping ranges intentionally each produce their own row.
 *
 * @param {Array<{
 *   id: number,
 *   streamerId: number,
 *   sectionIndexStart: number,
 *   sectionIndexEnd: number,
 *   sectionType: string,
 *   cleanedAt: string,
 *   cleaningMethod: string,
 * }>} events
 * @param {Map<string, number>} noiseMapBefore
 * @param {Map<string, number>} noiseMapAfter
 * @returns {Array<{
 *   id: number,
 *   streamerId: number,
 *   sectionIndexStart: number,
 *   sectionIndexEnd: number,
 *   cleanedAt: string,
 *   cleaningMethod: string,
 *   cellsInEvent: number,
 *   cellsPaired: number,
 *   meanImprovementPct: number | null,
 *   meanRmsBefore: number | null,
 *   meanRmsAfter: number | null,
 * }>}
 */
function computeNoiseEfficiencyByRange(events, noiseMapBefore, noiseMapAfter) {
  const results = [];
  for (const evt of events) {
    if (evt.sectionType !== "active") continue;

    const start = Math.min(evt.sectionIndexStart, evt.sectionIndexEnd);
    const end = Math.max(evt.sectionIndexStart, evt.sectionIndexEnd);

    // Build the key set for just this event's range (no cross-event dedup)
    const keys = new Set();
    for (let idx = start; idx <= end; idx++) {
      keys.add(`${evt.streamerId}:${idx + 1}`);
    }

    const kpi = computeNoiseEfficiency(keys, noiseMapBefore, noiseMapAfter);

    results.push({
      id: evt.id,
      streamerId: evt.streamerId,
      sectionIndexStart: evt.sectionIndexStart,
      sectionIndexEnd: evt.sectionIndexEnd,
      cleanedAt: evt.cleanedAt,
      cleaningMethod: evt.cleaningMethod,
      cellsInEvent: kpi.cellsInEvents,
      cellsPaired: kpi.cellsPaired,
      meanImprovementPct: kpi.meanImprovementPct,
      meanRmsBefore: kpi.meanRmsBefore,
      meanRmsAfter: kpi.meanRmsAfter,
    });
  }
  return results;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = {
  expandEventsToSectionKeys,
  buildNoiseMap,
  computeNoiseEfficiency,
  computeNoiseEfficiencyByRange,
};
