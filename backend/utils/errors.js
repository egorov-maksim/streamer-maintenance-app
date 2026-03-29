// utils/errors.js

/**
 * Keeps API error responses consistent so the SPA can always read `{ error: string }` and show toasts instead of ad-hoc JSON shapes.
 *
 * @param {Object} res - Express response
 * @param {number} status - HTTP status code
 * @param {string} message - Error message
 */
function sendError(res, status, message) {
  res.status(status).json({ error: message });
}

module.exports = { sendError };
