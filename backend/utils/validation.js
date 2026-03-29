// utils/validation.js

/**
 * Coerces query params and JSON fields to integers safely so vessel-scoped routes do not compare strings to IDs or pass NaN into SQLite.
 *
 * @param {*} n - Value to parse
 * @param {number} fallback - Value to return if parsing fails
 * @returns {number}
 */
function toInt(n, fallback) {
  const v = Number.parseInt(n, 10);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Guards REST `:id` parameters early with a consistent 400 body, avoiding duplicate NaN checks in every route handler.
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @returns {number|null} Parsed id or null
 */
function requireValidId(req, res) {
  const id = toInt(req.params.id, NaN);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return null;
  }
  return id;
}

module.exports = { toInt, requireValidId };
