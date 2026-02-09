// utils/errors.js

/**
 * Send a JSON error response with the standard { error: message } shape.
 * @param {Object} res - Express response
 * @param {number} status - HTTP status code
 * @param {string} message - Error message
 */
function sendError(res, status, message) {
  res.status(status).json({ error: message });
}

module.exports = { sendError };
