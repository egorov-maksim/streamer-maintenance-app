/**
 * Helpers for active vs tail section ranges (section_type).
 * Streamers number active sections 0..N-1 and tail segments separately; the UI and `/api/eb-range` must agree on how a dragged span splits across that boundary.
 * Active: 0..sectionsPerCable-1. Tail: tail-relative 0..4 (global sectionsPerCable..sectionsPerCable+4).
 */

/**
 * Splits a global section span into the portion on the main cable vs the tail, so tail segments can return "—" for EB and active segments use standard EB math.
 *
 * @param {number} start - 0-based global start
 * @param {number} end - 0-based global end (inclusive)
 * @param {Object} config - { sectionsPerCable, useRopeForTail }
 * @returns {{ active: { start: number, end: number } | null, tail: { start: number, end: number } | null }}
 */
function splitSectionRange(start, end, config) {
  const sectionsPerCable = config.sectionsPerCable ?? 107;
  const tailCount = config.useRopeForTail ? 0 : 5;
  const maxActive = sectionsPerCable - 1;
  const maxTailGlobal = sectionsPerCable + tailCount - 1;

  const actualStart = Math.min(start, end);
  const actualEnd = Math.max(start, end);

  if (actualEnd < sectionsPerCable) {
    return { active: { start: actualStart, end: actualEnd }, tail: null };
  }
  if (actualStart >= sectionsPerCable) {
    if (tailCount === 0) {
      return { active: null, tail: null };
    }
    const tailStart = actualStart - sectionsPerCable;
    const tailEnd = Math.min(actualEnd, maxTailGlobal) - sectionsPerCable;
    return { active: null, tail: { start: tailStart, end: tailEnd } };
  }
  const activeEnd = maxActive;
  const tailEndGlobal = Math.min(actualEnd, maxTailGlobal);
  const tailStart = 0;
  const tailEnd = tailCount > 0 ? tailEndGlobal - sectionsPerCable : -1;
  return {
    active: { start: actualStart, end: activeEnd },
    tail: tailCount > 0 && tailEnd >= 0 ? { start: tailStart, end: tailEnd } : null,
  };
}

/**
 * Validates user-supplied section spans per streamer geometry so bad tail indices cannot be saved as cleaning events.
 *
 * @param {number} start - 0-based start (active or tail-relative)
 * @param {number} end - 0-based end (inclusive)
 * @param {'active'|'tail'} sectionType
 * @param {Object} config - { sectionsPerCable, useRopeForTail }
 * @returns {{ valid: boolean, message?: string }}
 */
function validateRangeForType(start, end, sectionType, config) {
  const sectionsPerCable = config.sectionsPerCable ?? 107;
  const tailCount = config.useRopeForTail ? 0 : 5;
  const s = Math.min(start, end);
  const e = Math.max(start, end);

  if (sectionType === "active") {
    if (s < 0 || e >= sectionsPerCable) {
      return { valid: false, message: `Active sections must be 0..${sectionsPerCable - 1}` };
    }
    return { valid: true };
  }
  if (sectionType === "tail") {
    if (tailCount === 0) {
      return { valid: false, message: "Tail sections not configured (useRopeForTail)" };
    }
    if (s < 0 || e >= tailCount) {
      return { valid: false, message: `Tail sections must be 0..${tailCount - 1}` };
    }
    return { valid: true };
  }
  return { valid: false, message: "section_type must be 'active' or 'tail'" };
}

module.exports = { splitSectionRange, validateRangeForType };
