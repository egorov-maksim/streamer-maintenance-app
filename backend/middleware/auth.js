// middleware/auth.js
const crypto = require("crypto");

/** Role constants */
const ROLES = {
  SUPER_USER: "superuser",
  ADMIN: "admin",
  VIEWER: "viewer",
};

/**
 * Load user credentials from AUTH_USERS environment variable.
 * Format: USERNAME:PASSWORD:ROLE,USERNAME:PASSWORD:ROLE
 * @returns {Object.<string, { password: string, role: string }>}
 */
function loadUsersFromEnv() {
  const authUsersEnv = process.env.AUTH_USERS;
  const users = {};

  authUsersEnv.split(",").forEach(userStr => {
    const parts = userStr.trim().split(":");
    if (parts.length >= 3) {
      const username = parts[0].trim();
      const password = parts[1].trim();
      const role = parts[2].trim();
      users[username] = { password, role };
    }
  });

  return users;
}

/**
 * Generate a random session token.
 * @returns {string}
 */
function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Create auth middleware that validates Bearer token against the given session store.
 * @param {Map<string, Object>} sessions - Session store (token -> session)
 * @returns {function} Express middleware
 */
function createAuthMiddleware(sessions) {
  return function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.slice(7);
    const session = sessions.get(token);

    if (!session) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    req.user = session;
    next();
  };
}

/**
 * Express middleware: allow only superuser role.
 */
function superUserOnly(req, res, next) {
  if (req.user?.role !== ROLES.SUPER_USER) {
    return res.status(403).json({ error: "SuperUser access required" });
  }
  next();
}

/**
 * Express middleware: allow admin or superuser.
 */
function adminOrAbove(req, res, next) {
  if (req.user?.role !== ROLES.ADMIN && req.user?.role !== ROLES.SUPER_USER) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

/**
 * Express middleware: allow only admin role (legacy, for backward compatibility).
 */
function adminOnly(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

module.exports = {
  ROLES,
  loadUsersFromEnv,
  generateSessionToken,
  createAuthMiddleware,
  superUserOnly,
  adminOrAbove,
  adminOnly,
};
