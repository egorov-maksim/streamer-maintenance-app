// middleware/auth.js
const crypto = require("crypto");

/** Role constants */
const ROLES = {
  GRAND_SUPER_USER: "grandsuperuser",
  SUPERVISOR: "supervisor",
  SUPER_USER: "superuser",
  ADMIN: "admin",
  VIEWER: "viewer",
};

/**
 * Load user credentials from AUTH_USERS environment variable.
 *
 * Format per user (comma-separated list):
 *   USERNAME:PASSWORD_HASH:ROLE:VESSEL_TAG
 *
 * PASSWORD_HASH is a bcrypt hash (see INSTALL.md for generation).
 *
 * - ROLE: grandsuperuser | supervisor | superuser | admin | viewer
 * - VESSEL_TAG: short vessel code (e.g. TTN, RAM). Required for every role except
 *   grandsuperuser and supervisor, which are not tied to a vessel (use "ALL" as a placeholder).
 *
 * Only grandsuperuser is global (isGlobal); supervisor sees all vessels read-only but is not global. A fifth GLOBAL field from older .env files is ignored,
 * and an entry for any other role without a vessel tag is skipped.
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

  authUsersEnv.split(",").forEach((userStr) => {
    const parts = userStr.trim().split(":");
    if (parts.length < 4) {
      const username = (parts[0] || "").trim();
      if (username) {
        console.warn(
          `[auth] Skipping AUTH_USERS entry for "${username}" – expected USERNAME:PASSWORD_HASH:ROLE:VESSEL_TAG`
        );
      }
      return;
    }

    const username = parts[0].trim();
    const password = parts[1].trim();
    const role = parts[2].trim();
    const isGlobal = role === ROLES.GRAND_SUPER_USER;

    const rawVesselTag = (parts[3] || "").trim();
    const vesselTag = rawVesselTag === "" || rawVesselTag.toUpperCase() === "ALL"
      ? null
      : rawVesselTag;

    const vesselOptional = isGlobal || role === ROLES.SUPERVISOR;
    if (!vesselOptional && !vesselTag) {
      // Without a vessel tag the user would have no vessel restriction at all.
      console.warn(
        `[auth] Skipping AUTH_USERS entry for "${username}" – role "${role}" needs a vessel tag; ` +
          "only grandsuperuser and supervisor have access to all vessels."
      );
      return;
    }

    const rawGlobal = (parts[4] || "").trim().toLowerCase();
    if (!isGlobal && ["true", "1", "yes"].includes(rawGlobal)) {
      console.warn(
        `[auth] Ignoring GLOBAL flag for "${username}" – only grandsuperuser has access to all vessels. ` +
          `The user is limited to vessel "${vesselTag}".`
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
 * Only grandsuperuser is global; every other role is limited to its own vessel.
 * @param {{ role?: string }} user
 * @returns {boolean}
 */
function isGlobalUser(user) {
  return user?.role === ROLES.GRAND_SUPER_USER;
}

/**
 * May this user read data of every vessel? True for grandsuperuser and supervisor.
 * Unlike isGlobalUser this grants no write access.
 * @param {{ role?: string }} user
 * @returns {boolean}
 */
function canSeeAllVessels(user) {
  return user?.role === ROLES.GRAND_SUPER_USER || user?.role === ROLES.SUPERVISOR;
}

/**
 * Get the effective vessel scope for a user.
 * - Global users: null (no restriction)
 * - Per-vessel users: their vesselTag
 * @param {{ vesselTag?: string|null, role?: string }} user
 * @returns {string|null}
 */
function getVesselScope(user) {
  return isGlobalUser(user) ? null : user?.vesselTag || null;
}

/** The only requests a supervisor session may make: "METHOD path". Everything else is denied. */
const SUPERVISOR_ALLOWED = new Set([
  "GET /api/session",
  "GET /api/overview",
  "GET /api/overview/vessels",
]);

/**
 * Default-deny allowlist for the read-only supervisor role.
 * Strips ONE trailing slash and any query string; method and path are otherwise exact.
 * @param {string} method HTTP method (exact, upper case)
 * @param {string} path request path
 * @returns {boolean}
 */
function isSupervisorAllowed(method, path) {
  if (typeof method !== "string" || typeof path !== "string") return false;
  let p = path.split("?")[0];
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return SUPERVISOR_ALLOWED.has(`${method} ${p}`);
}

/**
 * Create auth middleware that validates Bearer token via sessionStore.getSession (TTL eviction).
 * @param {{ getSession: function(string): Object|null }} sessionStore
 * @returns {function} Express middleware
 */
function createAuthMiddleware(sessionStore) {
  return function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.slice(7);
    const session = sessionStore.getSession(token);

    if (!session) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    if (session.role === ROLES.SUPERVISOR && !isSupervisorAllowed(req.method, req.path)) {
      return res.status(403).json({ error: "Access denied" });
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
 * Express middleware: allow superuser or grandsuperuser.
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
  isSupervisorAllowed,
  isGlobalUser,
  canSeeAllVessels,
  getVesselScope,
  withVesselScope,
  requireRole,
  superUserOnly,
  adminOrAbove,
};
