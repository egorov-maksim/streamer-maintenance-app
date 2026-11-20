// utils/cleanedSections.js

const DAY_MS = 24 * 60 * 60 * 1000;

const round1 = (n) => Math.round(n * 10) / 10;
const pct = (part, whole) => (whole > 0 ? round1((part / whole) * 100) : 0);

/**
 * Unique cleaned sections as `${streamerId}-${globalIdx}` keys, where a tail section's
 * global index is offset by its streamer's active section count to keep keys unique.
 * @param {Array<{streamerId: number, sectionIndexStart: number, sectionIndexEnd: number, sectionType: string}>} events
 * @param {{ sectionsPerCable: number, sectionsPerCableMap: Object<number,number> }} config
 * @returns {{ active: Set<string>, tail: Set<string>, all: Set<string> }}
 */
function collectCleanedSections(events, config) {
  const sectionsPerCableMap = config.sectionsPerCableMap;
  const all = new Set();
  const active = new Set();
  const tail = new Set();
  for (const evt of events) {
    const isTail = evt.sectionType === "tail";
    // Use the streamer's effective sections as tail base offset to keep keys globally unique
    const effectiveSections = sectionsPerCableMap[evt.streamerId] ?? config.sectionsPerCable;
    const base = isTail ? effectiveSections : 0;
    for (let s = evt.sectionIndexStart; s <= evt.sectionIndexEnd; s++) {
      const globalIdx = base + s;
      all.add(`${evt.streamerId}-${globalIdx}`);
      if (isTail) {
        tail.add(`${evt.streamerId}-${globalIdx}`);
      } else {
        active.add(`${evt.streamerId}-${globalIdx}`);
      }
    }
  }
  return { active, tail, all };
}

/**
 * Section coverage of a set of cleaning events, matching the stats page:
 * (active + tail sections cleaned) / (active + tail sections available).
 * Indices outside a streamer's section count are ignored, as in /api/last-cleaned.
 * A section is overdue when it was never cleaned or last cleaned more than thresholdDays
 * before `now`; only active sections are checked for that.
 * @param {Array<{streamerId: number, sectionIndexStart: number, sectionIndexEnd: number, sectionType: string, cleanedAt: string}>} events
 * @param {{ numCables: number, sectionsPerCable: number, sectionsPerCableMap: Object<number,number>, useRopeForTail: boolean }} config
 * @param {{ windowStart: string, now: string, thresholdDays: number }} opts
 */
function summarizeSectionCoverage(events, config, { windowStart, now, thresholdDays }) {
  const tailSections = config.useRopeForTail ? 0 : 5;
  const activeCount = (streamerId) => config.sectionsPerCableMap[streamerId] ?? config.sectionsPerCable;
  let totalActiveSections = 0;
  for (let id = 1; id <= config.numCables; id++) totalActiveSections += activeCount(id);
  const totalSections = totalActiveSections + config.numCables * tailSections;

  // Per section: earliest and latest cleaning time (ms), keyed like collectCleanedSections.
  const seen = new Map();
  let lastCleanedMs = null;
  for (const evt of events) {
    if (!(evt.streamerId >= 1 && evt.streamerId <= config.numCables)) continue;
    const isTail = evt.sectionType === "tail";
    const limit = isTail ? tailSections : activeCount(evt.streamerId);
    const at = Date.parse(evt.cleanedAt);
    if (Number.isNaN(at)) continue;
    const from = Math.max(0, evt.sectionIndexStart);
    const to = Math.min(limit - 1, evt.sectionIndexEnd);
    if (from > to) continue;
    if (lastCleanedMs === null || at > lastCleanedMs) lastCleanedMs = at;
    for (let s = from; s <= to; s++) {
      const key = `${evt.streamerId}-${isTail ? "t" : "a"}${s}`;
      const entry = seen.get(key);
      if (!entry) seen.set(key, { first: at, last: at });
      else {
        if (at < entry.first) entry.first = at;
        if (at > entry.last) entry.last = at;
      }
    }
  }

  const startMs = Date.parse(windowStart);
  const cutoffMs = Date.parse(now) - thresholdDays * DAY_MS;
  let cleanedAtStart = 0;
  let activeFresh = 0;
  for (const [key, entry] of seen) {
    if (entry.first < startMs) cleanedAtStart++;
    if (key.split("-")[1][0] === "a" && entry.last >= cutoffMs) activeFresh++;
  }

  return {
    cleanedSections: seen.size,
    totalSections,
    coveragePct: pct(seen.size, totalSections),
    coverageAtStartPct: pct(cleanedAtStart, totalSections),
    overdueSections: totalActiveSections - activeFresh,
    totalActiveSections,
    lastCleanedAt: lastCleanedMs === null ? null : new Date(lastCleanedMs).toISOString(),
  };
}

module.exports = { collectCleanedSections, summarizeSectionCoverage };
