// utils/eb.js

/**
 * Calculate EB (Equipment Box) range for a section range.
 * Finds closest module AT OR BEFORE startSection and AT OR AFTER endSection.
 * @param {number} startSection - Start section index (0-based)
 * @param {number} endSection - End section index (0-based)
 * @param {Object} config - Config with moduleFrequency, sectionsPerCable
 * @returns {string} Formatted EB range (e.g. "EB05 - EB02") or "-"
 */
function calculateEBRange(startSection, endSection, config) {
  const moduleFreq = config.moduleFrequency || 4;
  const N = config.sectionsPerCable;

  const allModules = [];
  allModules.push({ num: 1, section: 0 });

  for (let s = moduleFreq; s < N; s += moduleFreq) {
    const moduleNum = Math.floor(s / moduleFreq) + 1;
    allModules.push({ num: moduleNum, section: s });
  }

  const lastModuleNum = Math.floor((N - 1) / moduleFreq) + 1;
  if (!allModules.some(m => m.num === lastModuleNum)) {
    allModules.push({ num: lastModuleNum, section: N - 1 });
  }

  const before = allModules
    .filter(m => m.section <= startSection)
    .sort((a, b) => b.section - a.section)[0];

  const after = allModules
    .filter(m => m.section >= endSection)
    .sort((a, b) => a.section - b.section)[0];

  const formatEB = (num) => `EB${String(num).padStart(2, "0")}`;

  if (before && after) {
    if (before.num === after.num) return formatEB(before.num);
    return `${formatEB(Math.max(before.num, after.num))} - ${formatEB(Math.min(before.num, after.num))}`;
  } else if (before) {
    return `Tail Adaptor - ${formatEB(before.num)}`;
  } else if (after) {
    return formatEB(after.num);
  }

  return "-";
}

module.exports = { calculateEBRange };
