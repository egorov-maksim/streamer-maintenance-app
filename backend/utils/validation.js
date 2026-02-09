// utils/validation.js

/**
 * Parse a value as integer with fallback.
 * @param {*} n - Value to parse
 * @param {number} fallback - Value to return if parsing fails
 * @returns {number}
 */
function toInt(n, fallback) {
  const v = Number.parseInt(n, 10);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Validate req.params.id as integer; send 400 and return null if invalid.
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
