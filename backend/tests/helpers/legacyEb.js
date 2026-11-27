// Frozen copy of calculateEBRange and countEBModules as of commit 368ff82 (before front eBird).
// Deliberate pin: tests compare the live implementation against it for ebFront off.

function legacyCalculateEBRange(startSection, endSection, config) {
  const start = Math.max(0, Math.min(startSection, endSection));
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

  // EB01 sits at section 0, so a module always exists at or before the start.
  // A span that runs past the last active section ends at the closing module.
  const before = allModules
    .filter((module) => module.section <= start)
    .sort((a, b) => b.section - a.section)[0];

  const after =
    allModules
      .filter((module) => module.section >= end)
      .sort((a, b) => a.section - b.section)[0] || allModules[allModules.length - 1];

  const formatEB = (num) => `EB${String(num).padStart(2, "0")}`;

  if (before.num === after.num) return formatEB(before.num);
  return `${formatEB(Math.max(before.num, after.num))} - ${formatEB(Math.min(before.num, after.num))}`;
}

function legacyCountEBModules(sectionsPerCable, moduleFrequency) {
  const sections = Number(sectionsPerCable);
  if (!Number.isFinite(sections) || sections < 1) return 0;
  const freq = moduleFrequency > 0 ? moduleFrequency : 4;
  const regular = 1 + Math.floor((sections - 1) / freq);
  return (sections - 1) % freq === 0 ? regular : regular + 1;
}

module.exports = { legacyCalculateEBRange, legacyCountEBModules };
