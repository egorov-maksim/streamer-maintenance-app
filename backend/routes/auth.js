// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const { generateSessionToken, isGlobalUser } = require("../middleware/auth");
const { ensureUsersSeeded, findUserForLogin } = require("../userStore");
const { sendError } = require("../utils/errors");

/**
 * Create auth router (login, logout, session).
 * @param {{ setSession: Function, deleteSession: Function }} sessionStore
 * @param {function} authMiddleware - Auth middleware for protected routes
 * @returns {express.Router}
 */
function createAuthRouter(sessionStore, authMiddleware) {
  const router = express.Router();

  router.post("/api/login", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return sendError(res, 400, "Username and password required");
    }

    if (typeof username !== "string" || typeof password !== "string") {
      return sendError(res, 400, "Username and password required");
    }

    let user;
    try {
      await ensureUsersSeeded();
      user = await findUserForLogin(username.trim());
    } catch (err) {
      console.error("POST /api/login failed", err);
      return sendError(res, 500, "Login failed");
    }
    if (!user) {
      return sendError(res, 401, "Invalid credentials");
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      return sendError(res, 401, "Invalid credentials");
    }

    // Use the stored spelling of the username, whatever case was typed.
    const session = {
      username: user.username,
      role: user.role,
      vesselTag: user.vesselTag ?? null,
      isGlobal: isGlobalUser(user),
    };
    const token = generateSessionToken();
    sessionStore.setSession(token, session);

    res.json({ token, ...session, message: "Login successful" });
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
