// utils/sectionCleanCounts.js

/**
 * Per-section clean count: how many times each section has been cleaned.
 *
 * A section's count is the sum of `cleaning_count` over every event whose range covers it.
 * `cleaning_count` is 1 for each logged event, so the count is the number of events covering
 * the section; the same rule is used by the heatmap tooltip ("total times cleaned").
 */

/** A logged event counts once unless it carries a larger positive whole number. */
function eventCount(evt) {
  const n = Number(evt.cleaningCount);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * Count cleanings per section.
 *
 * Active sections beyond a streamer's effective length (per-streamer sections override) are
 * not part of the spread and are left out. Tail sections are counted separately from active
 * sections with the same index.
 *
 * @param {Array<{
 *   streamerId: number, sectionIndexStart: number, sectionIndexEnd: number,
 *   sectionType?: string, cleaningMethod?: string, cleanedAt?: string, cleaningCount?: number,
 * }>} events
 * @param {{ sectionsPerCableMap?: Object<number, number>, sectionsPerCable?: number }} [config]
 * @returns {Array<{
 *   streamerId: number, sectionType: "active"|"tail", sectionIndex: number,
 *   count: number, byMethod: Object<string, number>, lastCleanedAt: string|null,
 * }>} sorted by streamer, then active before tail, then section index
 */
function computeSectionCleanCounts(events, config = {}) {
  const { sectionsPerCableMap = {}, sectionsPerCable } = config;
  const bySection = new Map();

  for (const evt of events) {
    const sectionType = evt.sectionType === "tail" ? "tail" : "active";
    const start = Math.min(evt.sectionIndexStart, evt.sectionIndexEnd);
    let end = Math.max(evt.sectionIndexStart, evt.sectionIndexEnd);
    if (sectionType === "active") {
      const limit = sectionsPerCableMap[evt.streamerId] ?? sectionsPerCable;
      if (Number.isFinite(limit)) end = Math.min(end, limit - 1);
    }
    const count = eventCount(evt);
    const method = evt.cleaningMethod || "unknown";

    for (let sectionIndex = Math.max(0, start); sectionIndex <= end; sectionIndex++) {
      const key = `${evt.streamerId}:${sectionType}:${sectionIndex}`;
      let entry = bySection.get(key);
      if (!entry) {
        entry = { streamerId: evt.streamerId, sectionType, sectionIndex, count: 0, byMethod: {}, lastCleanedAt: null };
        bySection.set(key, entry);
      }
      entry.count += count;
      entry.byMethod[method] = (entry.byMethod[method] || 0) + count;
      if (evt.cleanedAt && (!entry.lastCleanedAt || new Date(evt.cleanedAt) > new Date(entry.lastCleanedAt))) {
        entry.lastCleanedAt = evt.cleanedAt;
      }
    }
  }

  return [...bySection.values()].sort(
    (a, b) =>
      a.streamerId - b.streamerId ||
      (a.sectionType === b.sectionType ? 0 : a.sectionType === "active" ? -1 : 1) ||
      a.sectionIndex - b.sectionIndex
  );
}

function sameMethods(a, b) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/**
 * Join neighbouring sections of one streamer that were cleaned the same number of times
 * with the same methods, so a ranking reads "S3 AS01–AS10, 5 times" instead of ten rows.
 *
 * @param {ReturnType<typeof computeSectionCleanCounts>} sections - sorted as returned above
 * @returns {Array<{
 *   streamerId: number, sectionType: "active"|"tail", sectionIndexStart: number, sectionIndexEnd: number,
 *   sectionCount: number, count: number, byMethod: Object<string, number>, lastCleanedAt: string|null,
 * }>}
 */
function groupSectionCleanCounts(sections) {
  const groups = [];
  for (const section of sections) {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.streamerId === section.streamerId &&
      last.sectionType === section.sectionType &&
      last.sectionIndexEnd === section.sectionIndex - 1 &&
      last.count === section.count &&
      sameMethods(last.byMethod, section.byMethod)
    ) {
      last.sectionIndexEnd = section.sectionIndex;
      last.sectionCount++;
      if (section.lastCleanedAt && (!last.lastCleanedAt || new Date(section.lastCleanedAt) > new Date(last.lastCleanedAt))) {
        last.lastCleanedAt = section.lastCleanedAt;
      }
    } else {
      groups.push({
        streamerId: section.streamerId,
        sectionType: section.sectionType,
        sectionIndexStart: section.sectionIndex,
        sectionIndexEnd: section.sectionIndex,
        sectionCount: 1,
        count: section.count,
        byMethod: { ...section.byMethod },
        lastCleanedAt: section.lastCleanedAt,
      });
    }
  }
  return groups;
}

/**
 * Rank section ranges from most to least cleaned.
 * Ties are ordered by the longer range first, then streamer and position.
 * @param {ReturnType<typeof groupSectionCleanCounts>} groups
 * @param {number} limit
 */
function rankMostCleaned(groups, limit) {
  return [...groups]
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.sectionCount - a.sectionCount ||
        a.streamerId - b.streamerId ||
        a.sectionIndexStart - b.sectionIndexStart
    )
    .slice(0, limit);
}

/**
 * Totals per streamer: cleanings summed over its sections, sections cleaned at least once,
 * and the highest count on any one section.
 * @param {ReturnType<typeof computeSectionCleanCounts>} sections
 */
function summarizeByStreamer(sections) {
  const byStreamer = new Map();
  for (const section of sections) {
    let row = byStreamer.get(section.streamerId);
    if (!row) {
      row = { streamerId: section.streamerId, sectionsCleaned: 0, totalCleanings: 0, maxCount: 0 };
      byStreamer.set(section.streamerId, row);
    }
    row.sectionsCleaned++;
    row.totalCleanings += section.count;
    row.maxCount = Math.max(row.maxCount, section.count);
  }
  return [...byStreamer.values()].sort((a, b) => a.streamerId - b.streamerId);
}

module.exports = { computeSectionCleanCounts, groupSectionCleanCounts, rankMostCleaned, summarizeByStreamer };
