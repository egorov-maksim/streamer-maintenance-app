// routes/auth.js
const express = require("express");
const { generateSessionToken } = require("../middleware/auth");
const { sendError } = require("../utils/errors");

/**
 * Create auth router (login, logout, session).
 * @param {{ setSession: Function, deleteSession: Function }} sessionStore
 * @param {Object} users - User credentials from loadUsersFromEnv()
 * @param {function} authMiddleware - Auth middleware for protected routes
 * @returns {express.Router}
 */
function createAuthRouter(sessionStore, users, authMiddleware) {
  const router = express.Router();

  router.post("/api/login", (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return sendError(res, 400, "Username and password required");
    }

    const user = users[username];
    if (!user || user.password !== password) {
      return sendError(res, 401, "Invalid credentials");
    }

    const token = generateSessionToken();
    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/67e18581-87c7-4241-aa8e-2a9878a99534", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: "routes/auth.js:POST /api/login",
        message: "sessionStore API surface (pre setSession)",
        data: {
          hypothesisId: "H1",
          ctor: sessionStore?.constructor?.name,
          hasSetSession: typeof sessionStore?.setSession,
          hasGetSession: typeof sessionStore?.getSession,
          hasMapSet: typeof sessionStore?.set,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    sessionStore.setSession(token, {
      username,
      role: user.role,
      vesselTag: user.vesselTag ?? null,
      isGlobal: Boolean(user.isGlobal),
    });

    res.json({
      token,
      username,
      role: user.role,
      vesselTag: user.vesselTag ?? null,
      isGlobal: Boolean(user.isGlobal),
      message: "Login successful",
    });
  });

  router.post("/api/logout", (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      sessionStore.deleteSession(token);
    }
    res.json({ success: true, message: "Logged out successfully" });
  });

  router.get("/api/session", authMiddleware, (req, res) => {
    res.json({
      username: req.user.username,
      role: req.user.role,
      vesselTag: req.user.vesselTag ?? null,
      isGlobal: Boolean(req.user.isGlobal),
    });
  });

  return router;
}

module.exports = { createAuthRouter };
