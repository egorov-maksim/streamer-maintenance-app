/**
 * Shared helpers for computing per-streamer heatmap grid dimensions.
 * Centralises the "how many grid cells does this streamer column/row need?" logic
 * so vertical, horizontal and planning heatmaps all stay in sync when streamer
 * lengths differ via sectionsPerCableOverrides.
 */

/**
 * Decides whether an EB module cell should be inserted after a given section.
 * A module appears at the first section, at every regular interval, and at the
 * last active section of this specific streamer — ensuring shorter streamers
 * always close with a final EB label rather than stopping mid-interval.
 *
 * @param {number} sectionNumber - 1-based section position within this streamer
 * @param {number} sectionCount  - total active sections for this streamer
 * @param {number} moduleFreq    - sections between regular EB placements (e.g. 4)
 * @returns {boolean}
 */
export function shouldInsertModuleAfterSection(sectionNumber, sectionCount, moduleFreq) {
  if (sectionNumber === 1) return true;
  if (sectionNumber === sectionCount) return true;
  return sectionNumber > 1 && (sectionNumber - 1) % moduleFreq === 0;
}

/**
 * Counts the total number of grid rows (or columns in horizontal mode) that a
 * single streamer occupies: one cell per active section, plus one cell per EB
 * module insertion, plus one cell per tail section.
 * Used to set gridTemplateRows / gridTemplateColumns per streamer so shorter
 * streamers do not carry silent inactive-placeholder rows before their tails.
 *
 * @param {number} sectionCount  - active sections for this streamer
 * @param {number} moduleFreq    - EB module insertion frequency
 * @param {number} tailSections  - number of tail sections (0 when useRopeForTail)
 * @param {boolean} [ebFront=false] - project has an extra EB in front of the first section
 * @returns {number}
 */
export function countHeatmapColumnRows(sectionCount, moduleFreq, tailSections, ebFront = false) {
  let count = ebFront ? 1 : 0; // front EB cell directly before AS01
  for (let s = 0; s < sectionCount; s++) {
    count++; // section cell
    if (shouldInsertModuleAfterSection(s + 1, sectionCount, moduleFreq)) {
      count++; // module cell
    }
  }
  count += tailSections;
  return count;
}

/**
 * The one EB placement rule, ported from backend/utils/eb.js (the two must return equal output).
 * Returns the EB modules of a streamer in cable order, numbered from 1. Flag off: one at AS01
 * (afterSection 0), one every moduleFreq sections, and a closing one on the last section when it
 * has none. Flag on: an extra EB01 directly in front of AS01 (afterSection -1), everything else
 * one number higher.
 *
 * @param {number} sectionCount - active sections on this streamer
 * @param {number} moduleFreq - sections between regular EB placements (4 when not a positive integer)
 * @param {boolean} [ebFront=false] - project has an EB in front of AS01
 * @returns {Array<{num: number, afterSection: number, kind: "front"|"first"|"regular"|"closing"}>}
 */
export function getModuleLayout(sectionCount, moduleFreq, ebFront = false) {
  const sections = Number(sectionCount);
  if (!Number.isFinite(sections) || sections < 1) return [];
  const freq = Number.isInteger(moduleFreq) && moduleFreq > 0 ? moduleFreq : 4;

  const placed = [];
  if (ebFront) placed.push({ afterSection: -1, kind: "front" });
  placed.push({ afterSection: 0, kind: "first" });
  for (let section = freq; section < sections; section += freq) {
    placed.push({ afterSection: section, kind: "regular" });
  }
  if (placed[placed.length - 1].afterSection !== sections - 1) {
    placed.push({ afterSection: sections - 1, kind: "closing" });
  }
  return placed.map((module, index) => ({ num: index + 1, ...module }));
}

/**
 * EB numbers and separator rows for the PDF heatmaps (right-hand EB labels and bold lines).
 * Numbers and positions come from getModuleLayout, so the closing EB carries the same number as on
 * the heatmap (before the fix the PDF used floor((maxSections - 1) / moduleFreq) + 1 for it, which
 * was one lower whenever the last section is not a regular EB position). The front EB has no row of
 * its own; its number is returned as frontModuleNum so the PDF can label it above the first row.
 *
 * @param {Object} opts
 * @param {number} opts.moduleFreq - sections between regular EB placements
 * @param {number} opts.maxSections - largest active section count over all streamers
 * @param {number} opts.totalSections - rows on the page (max sections plus tails)
 * @param {boolean} [opts.ebFront=false] - project has an EB in front of AS01
 * @returns {{modulesBySection: Array<number|null>, separatorRows: number[], frontModuleNum: number|null}}
 */
export function buildPdfModulePositions({ moduleFreq, maxSections, totalSections, ebFront = false }) {
  const modulesBySection = Array.from({ length: totalSections }, () => null);
  const separatorRows = [];
  let frontModuleNum = null;

  for (const module of getModuleLayout(maxSections, moduleFreq, ebFront)) {
    if (module.afterSection < 0) {
      frontModuleNum = module.num;
      continue;
    }
    if (module.afterSection < totalSections) modulesBySection[module.afterSection] = module.num;
    if (module.num % 2 === 0 && module.kind !== "closing") separatorRows.push(module.afterSection);
  }
  return { modulesBySection, separatorRows, frontModuleNum };
}
