const { getOneCamelized } = require("./db");

/**
 * Resolve the active project for a vessel (Option C: vessel_context table).
 * @param {string} vesselTag - Vessel tag (e.g. "TTN", "V2")
 * @returns {Promise<Object|null>} Active project row (camelCase) or null
 */
async function getActiveProjectForVessel(vesselTag) {
  if (!vesselTag || typeof vesselTag !== "string") return null;
  const project = await getOneCamelized(
    `SELECT p.* FROM projects p
     INNER JOIN vessel_context v ON v.active_project_id = p.id
     WHERE v.vessel_tag = ? AND v.active_project_id IS NOT NULL`,
    [vesselTag.trim()]
  );
  return project;
}

module.exports = { getActiveProjectForVessel };
