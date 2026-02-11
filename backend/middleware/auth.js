// middleware/auth.js
const crypto = require("crypto");

/** Role constants */
const ROLES = {
  GRAND_SUPER_USER: "grandsuperuser",
  SUPER_USER: "superuser",
  ADMIN: "admin",
  VIEWER: "viewer",
};

/**
 * Load user credentials from AUTH_USERS environment variable.
 * New format (recommended):
 *   USERNAME:PASSWORD:ROLE:VESSEL_TAG[:GLOBAL]
 *
 * - ROLE: grandsuperuser | superuser | admin | viewer
 * - VESSEL_TAG: required for non-global users (e.g. TTN, RAM, etc.)
 * - GLOBAL (optional): "true" marks the user as global (all vessels)
 *
 * Legacy format (still supported for backward compatibility):
 *   USERNAME:PASSWORD:ROLE
 * These users are treated as global (no vessel restriction).
 *
 * @returns {Object.<string, { password: string, role: string, vesselTag: string|null, isGlobal: boolean }>}
 */
function loadUsersFromEnv() {
  const authUsersEnv = process.env.AUTH_USERS;
  const users = {};

  if (!authUsersEnv || !authUsersEnv.trim()) {
    console.warn("[auth] AUTH_USERS is empty; no users configured.");
    return users;
  }

  authUsersEnv.split(",").forEach(userStr => {
    const parts = userStr.trim().split(":");
    if (parts.length < 3) return;

    const username = parts[0].trim();
    const password = parts[1].trim();
    const role = parts[2].trim();

    // Legacy format: USER:PASS:ROLE
    if (parts.length === 3) {
      users[username] = {
        password,
        role,
        vesselTag: null,
        // Legacy users are treated as global (same behavior as before).
        isGlobal: true,
      };
      console.warn(
        `[auth] User "${username}" is using legacy AUTH_USERS format (USERNAME:PASSWORD:ROLE). ` +
          "Please update to USERNAME:PASSWORD:ROLE:VESSEL_TAG[:GLOBAL] to enable per-vessel scoping."
      );
      return;
    }

    // New format with vessel tag (and optional global flag)
    const rawVesselTag = (parts[3] || "").trim();
    const vesselTag = rawVesselTag === "" || rawVesselTag.toUpperCase() === "ALL"
      ? null
      : rawVesselTag;

    let isGlobal = false;
    if (parts.length >= 5) {
      const rawGlobal = (parts[4] || "").trim().toLowerCase();
      isGlobal = rawGlobal === "true" || rawGlobal === "1" || rawGlobal === "yes";
    } else if (role === ROLES.GRAND_SUPER_USER) {
      // Grand superuser is implicitly global if GLOBAL not explicitly provided.
      isGlobal = true;
    } else if (!vesselTag) {
      // If no vessel tag is provided for non-grand roles, treat as global but warn.
      isGlobal = true;
      console.warn(
        `[auth] User "${username}" has no vessel tag configured. ` +
          "They will be treated as global until a vessel tag is added."
      );
    }

    users[username] = {
      password,
      role,
      vesselTag,
      isGlobal,
    };
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
 * Determine whether a user has global (all-vessel) access.
 * @param {{ isGlobal?: boolean, role?: string }} user
 * @returns {boolean}
 */
function isGlobalUser(user) {
  if (!user) return false;
  if (user.isGlobal) return true;
  // Grand superuser is always treated as global.
  return user.role === ROLES.GRAND_SUPER_USER;
}

/**
 * Get the effective vessel scope for a user.
 * - Global users: null (no restriction)
 * - Per-vessel users: their vesselTag
 * @param {{ vesselTag?: string|null, isGlobal?: boolean, role?: string }} user
 * @returns {string|null}
 */
function getVesselScope(user) {
  return isGlobalUser(user) ? null : user?.vesselTag || null;
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
    // Attach vessel scope for downstream middleware/handlers.
    req.vesselScope = getVesselScope(session);
    next();
  };
}

/**
 * Attach vessel scope to the request based on the authenticated user.
 * Global users → req.vesselScope = null (no restriction).
 * Per-vessel users → req.vesselScope = user.vesselTag.
 */
function withVesselScope(req, _res, next) {
  req.vesselScope = getVesselScope(req.user);
  next();
}

/**
 * Factory for role-based guards.
 * @param {string[]} allowedRoles
 * @returns {function} Express middleware
 */
function requireRole(allowedRoles) {
  return function roleGuard(req, res, next) {
    const role = req.user?.role;
    if (!role) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ error: "Access denied" });
    }
    next();
  };
}

/**
 * Express middleware: allow only superuser role.
 */
function superUserOnly(req, res, next) {
  // Grand superuser is always allowed anywhere a regular superuser is.
  return requireRole([ROLES.SUPER_USER, ROLES.GRAND_SUPER_USER])(req, res, next);
}

/**
 * Express middleware: allow admin or superuser.
 */
function adminOrAbove(req, res, next) {
  return requireRole([ROLES.ADMIN, ROLES.SUPER_USER, ROLES.GRAND_SUPER_USER])(req, res, next);
}

module.exports = {
  ROLES,
  loadUsersFromEnv,
  generateSessionToken,
  createAuthMiddleware,
  isGlobalUser,
  getVesselScope,
  withVesselScope,
  requireRole,
  superUserOnly,
  adminOrAbove,
};
