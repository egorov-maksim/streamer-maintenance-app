// utils/queryHelpers.js

/**
 * Build WHERE clause and params for cleaning_events queries filtered by project and date range.
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
