// utils/eb.js

/**
 * Maps a streamer section span to human-readable Equipment Box (EB) labels for maintenance reports and API responses.
 * Crew reason about physical modules along the cable; this keeps server-side EB strings aligned with heatmap logic.
 *
 * Finds the closest module at or before the span start and at or after the span end (order-independent).
 *
 * @param {number} startSection - Start section index (0-based)
 * @param {number} endSection - End section index (0-based)
 * @param {Object} config - Config with moduleFrequency, sectionsPerCable
 * @returns {string} Formatted EB range (e.g. "EB05 - EB02") or "-"
 */
function calculateEBRange(startSection, endSection, config) {
  const start = Math.min(startSection, endSection);
  const end = Math.max(startSection, endSection);
  const moduleFreq = config.moduleFrequency || 4;
  const sectionsPerCable = config.sectionsPerCable;

  const allModules = [];
  allModules.push({ num: 1, section: 0 });

  for (let sectionIndex = moduleFreq; sectionIndex < sectionsPerCable; sectionIndex += moduleFreq) {
    const moduleNum = Math.floor(sectionIndex / moduleFreq) + 1;
    allModules.push({ num: moduleNum, section: sectionIndex });
  }

  // Always add a fixed EB at the last active section if not already there,
  // matching the heatmap's isLastModule rule in app.js.
  const lastBuilt = allModules[allModules.length - 1];
  if (lastBuilt.section !== sectionsPerCable - 1) {
    allModules.push({ num: lastBuilt.num + 1, section: sectionsPerCable - 1 });
  }

  const before = allModules
    .filter((module) => module.section <= start)
    .sort((a, b) => b.section - a.section)[0];

  const after = allModules
    .filter((module) => module.section >= end)
    .sort((a, b) => a.section - b.section)[0];

  const effectiveAfter = after || allModules[allModules.length - 1];

  const formatEB = (num) => `EB${String(num).padStart(2, "0")}`;

  if (before && effectiveAfter) {
    if (before.num === effectiveAfter.num) return formatEB(before.num);
    return `${formatEB(Math.max(before.num, effectiveAfter.num))} - ${formatEB(Math.min(before.num, effectiveAfter.num))}`;
  } else if (before) {
    return `Tail Adaptor - ${formatEB(before.num)}`;
  } else if (effectiveAfter) {
    return formatEB(effectiveAfter.num);
  }

  return "-";
}

module.exports = { calculateEBRange };
