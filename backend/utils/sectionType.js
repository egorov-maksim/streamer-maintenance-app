/**
 * Helpers for active vs tail section ranges (section_type).
 * Active: 0..sectionsPerCable-1. Tail: tail-relative 0..4 (global sectionsPerCable..sectionsPerCable+4).
 */

/**
 * Split a global section range into active and/or tail parts.
 * @param {number} start - 0-based global start
 * @param {number} end - 0-based global end (inclusive)
 * @param {Object} config - { sectionsPerCable, useRopeForTail }
 * @returns {{ active: { start: number, end: number } | null, tail: { start: number, end: number } | null }}
 */
function splitSectionRange(start, end, config) {
  const sectionsPerCable = config.sectionsPerCable ?? 107;
  const tailCount = config.useRopeForTail ? 0 : 5;
  const maxActive = sectionsPerCable - 1;
  const minTailGlobal = sectionsPerCable;
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
  // Crossing: active part and tail part
  const activeEnd = maxActive;
  const tailStartGlobal = sectionsPerCable;
  const tailEndGlobal = Math.min(actualEnd, maxTailGlobal);
  const tailStart = 0;
  const tailEnd = tailCount > 0 ? tailEndGlobal - sectionsPerCable : -1;
  return {
    active: { start: actualStart, end: activeEnd },
    tail: tailCount > 0 && tailEnd >= 0 ? { start: tailStart, end: tailEnd } : null,
  };
}

/**
 * Validate range for a given section_type.
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
