// utils/queryHelpers.js

/**
 * Builds SQL fragments for cleaning-event history so stats and exports stay vessel- and date-filtered without duplicating WHERE logic in every route.
 *
 * @param {{ project?: string, start?: string, end?: string }} query - project_number, start date, end date
 * @returns {{ sql: string, params: Array }} sql is " WHERE ..." or "", params for placeholders
 */
function buildEventsWhereClause(query) {
  const params = [];
  const conditions = [];

  if (query.project) {
    conditions.push("project_number = ?");
    params.push(query.project);
  }

  if (query.start && query.end) {
    conditions.push("DATE(cleaned_at) BETWEEN DATE(?) AND DATE(?)");
    params.push(query.start, query.end);
  } else if (query.start) {
    conditions.push("DATE(cleaned_at) >= DATE(?)");
    params.push(query.start);
  } else if (query.end) {
    conditions.push("DATE(cleaned_at) <= DATE(?)");
    params.push(query.end);
  }

  const sql = conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";
  return { sql, params };
}

module.exports = { buildEventsWhereClause };
