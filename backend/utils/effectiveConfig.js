// utils/effectiveConfig.js
const { getAllCamelized, getOneCamelized } = require("../db");
const { loadConfig } = require("../config");
const { getActiveProjectForVessel } = require("../activeProject");
const { httpError } = require("./errors");

/**
 * Build a per-streamer effective sections map for a project, using the project default
 * for any streamer that does not have a specific override in streamer_deployments.
 * @param {number|null} projectId
 * @param {number} numCables
 * @param {number} defaultSections
 * @returns {Promise<Object>} e.g. { 1: 107, 2: 107, 3: 120, ... }
 */
async function buildSectionsPerCableMap(projectId, numCables, defaultSections) {
  const map = {};
  for (let i = 1; i <= numCables; i++) {
    map[i] = defaultSections;
  }
  if (projectId == null) return map;
  const overrides = await getAllCamelized(
    "SELECT streamer_id, sections_per_cable FROM streamer_deployments WHERE project_id = ? AND sections_per_cable IS NOT NULL",
    [projectId]
  );
  for (const row of overrides) {
    if (map[row.streamerId] !== undefined) {
      map[row.streamerId] = row.sectionsPerCable;
    }
  }
  return map;
}

/**
 * Resolve the cable geometry of a vessel: the project named by projectNumber, or else the
 * active project of vesselTag, falling back to the app config. The vessel is passed
 * explicitly so a global user (no vesselScope) never silently gets another vessel's geometry.
 * @param {{ projectNumber?: string, vesselTag: string, vesselScope?: string|null }} opts
 * @returns {Promise<Object>} app config plus numCables, sectionsPerCable, useRopeForTail, ebFront, sectionLength, sectionsPerCableMap
 */
async function resolveEffectiveConfig({ projectNumber, vesselTag, vesselScope }) {
  const config = await loadConfig();
  let projectRow = null;
  if (projectNumber) {
    projectRow = await getOneCamelized("SELECT * FROM projects WHERE project_number = ?", [projectNumber]);
    // A vessel-scoped user may not read another vessel's cable geometry via ?project=.
    if (projectRow && vesselScope && projectRow.vesselTag !== vesselScope) {
      throw httpError(403, "Project does not belong to your vessel");
    }
  } else {
    projectRow = await getActiveProjectForVessel(vesselTag);
  }
  const numCables = projectRow?.numCables ?? config.numCables;
  const sectionsPerCable = projectRow?.sectionsPerCable ?? config.sectionsPerCable;
  const sectionsPerCableMap = await buildSectionsPerCableMap(projectRow?.id ?? null, numCables, sectionsPerCable);
  return {
    ...config,
    numCables,
    sectionsPerCable,
    useRopeForTail: projectRow != null ? projectRow.useRopeForTail === 1 : config.useRopeForTail,
    ebFront: projectRow != null ? projectRow.ebFront === 1 : false,
    sectionLength: projectRow?.sectionLength ?? config.sectionLength,
    sectionsPerCableMap,
  };
}

module.exports = { buildSectionsPerCableMap, resolveEffectiveConfig };
