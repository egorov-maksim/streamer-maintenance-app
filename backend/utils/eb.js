// utils/eb.js

/**
 * The one EB placement rule. Returns the EB modules of a streamer in cable order, numbered from 1.
 * Flag off: one at AS01 (afterSection 0), one every moduleFreq sections, and a closing one on the
 * last section when it has none. Flag on (front eBird): an extra EB01 directly in front of AS01
 * (afterSection -1) and everything else counted one higher, the first EB sitting right behind AS01.
 *
 * @param {number} sectionCount - active sections on this streamer
 * @param {number} moduleFreq - sections between regular EB placements (4 when not a positive integer)
 * @param {boolean} [ebFront=false] - project has an EB in front of AS01
 * @returns {Array<{num: number, afterSection: number, kind: "front"|"first"|"regular"|"closing"}>}
 *   afterSection is the 0-based section the EB sits behind, -1 for the front EB
 */
function getModuleLayout(sectionCount, moduleFreq, ebFront = false) {
  const sections = Number(sectionCount);
  if (!Number.isFinite(sections) || sections < 1) return [];
  const freq = Number.isInteger(moduleFreq) && moduleFreq > 0 ? moduleFreq : 4;

  const placed = [];
  if (ebFront) placed.push({ afterSection: -1, kind: "front" });
  placed.push({ afterSection: 0, kind: "first" });
  for (let section = freq; section < sections; section += freq) {
    placed.push({ afterSection: section, kind: "regular" });
  }
  // Closing EB on the last active section, matching the heatmap's isLastModule rule in app.js.
  if (placed[placed.length - 1].afterSection !== sections - 1) {
    placed.push({ afterSection: sections - 1, kind: "closing" });
  }
  return placed.map((module, index) => ({ num: index + 1, ...module }));
}

/**
 * Maps a streamer section span to human-readable Equipment Box (EB) labels for maintenance reports and API responses.
 * Crew reason about physical modules along the cable; this keeps server-side EB strings aligned with heatmap logic.
 *
 * Finds the closest module at or before the span start and at or after the span end (order-independent).
 *
 * @param {number} startSection - Start section index (0-based)
 * @param {number} endSection - End section index (0-based)
 * @param {Object} config - Config with moduleFrequency, sectionsPerCable, ebFront
 * @returns {string} Formatted EB range (e.g. "EB05 - EB02"), or a single EB when both ends map to the same module
 */
function calculateEBRange(startSection, endSection, config) {
  const start = Math.max(0, Math.min(startSection, endSection));
  const end = Math.max(startSection, endSection);
  const allModules = getModuleLayout(config.sectionsPerCable, config.moduleFrequency, Boolean(config.ebFront));
  const formatEB = (num) => `EB${String(num).padStart(2, "0")}`;
  if (allModules.length === 0) return formatEB(1);

  // The first module sits at or before section 0, so one always exists at or before the start.
  // A span that runs past the last active section ends at the closing module.
  const before = allModules
    .filter((module) => module.afterSection <= start)
    .sort((a, b) => b.afterSection - a.afterSection)[0];

  const after =
    allModules
      .filter((module) => module.afterSection >= end)
      .sort((a, b) => a.afterSection - b.afterSection)[0] || allModules[allModules.length - 1];

  if (before.num === after.num) return formatEB(before.num);
  return `${formatEB(Math.max(before.num, after.num))} - ${formatEB(Math.min(before.num, after.num))}`;
}

/**
 * Counts the EB modules on one streamer, using the same placement rule as the heatmap and
 * calculateEBRange (see getModuleLayout).
 *
 * @param {number} sectionsPerCable - active sections on this streamer
 * @param {number} moduleFrequency - sections between regular EB placements
 * @param {boolean} [ebFront=false] - project has an EB in front of AS01
 * @returns {number} highest valid EB number (0 when the streamer has no sections)
 */
function countEBModules(sectionsPerCable, moduleFrequency, ebFront = false) {
  return getModuleLayout(sectionsPerCable, moduleFrequency, ebFront).length;
}

module.exports = { getModuleLayout, calculateEBRange, countEBModules };
