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
 * @returns {number}
 */
export function countHeatmapColumnRows(sectionCount, moduleFreq, tailSections) {
  let count = 0;
  for (let s = 0; s < sectionCount; s++) {
    count++; // section cell
    if (shouldInsertModuleAfterSection(s + 1, sectionCount, moduleFreq)) {
      count++; // module cell
    }
  }
  count += tailSections;
  return count;
}
