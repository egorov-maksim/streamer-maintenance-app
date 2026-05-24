// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
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

  router.post("/api/login", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return sendError(res, 400, "Username and password required");
    }

    const user = users[username];
    if (!user) {
      return sendError(res, 401, "Invalid credentials");
    }

    const passwordOk = await bcrypt.compare(password, user.password);
    if (!passwordOk) {
      return sendError(res, 401, "Invalid credentials");
    }

    const token = generateSessionToken();
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
