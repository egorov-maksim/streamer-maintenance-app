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

/**
 * Builds an Error carrying an HTTP status so helpers deep in a route can refuse a
 * request (e.g. a project outside the caller's vessel) and the handler can relay it.
 * @param {number} status
 * @param {string} message
 * @returns {Error & { status: number }}
 */
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Route catch-block helper: relays an httpError as-is, logs anything else and
 * answers with a generic 500 so internal details never reach the client.
 * @param {Object} res - Express response
 * @param {Error} err
 * @param {string} fallbackMessage - Message for unexpected errors
 */
function handleRouteError(res, err, fallbackMessage) {
  if (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    return sendError(res, err.status, err.message);
  }
  console.error(err);
  return sendError(res, 500, fallbackMessage);
}

module.exports = { sendError, httpError, handleRouteError };
