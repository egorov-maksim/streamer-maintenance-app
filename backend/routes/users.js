// routes/users.js
const express = require("express");
const bcrypt = require("bcryptjs");
const { runAsync, getOneCamelized } = require("../db");
const { ROLES, isGlobalUser } = require("../middleware/auth");
const { sendError } = require("../utils/errors");
const { requireValidId } = require("../utils/validation");
const { ensureUsersSeeded, findUserById, listUsers, countGrandSuperUsers } = require("../userStore");

const MIN_PASSWORD_LENGTH = 8;
const BCRYPT_COST = process.env.NODE_ENV === "test" ? 4 : 10;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;
const VESSEL_TAG_PATTERN = /^[A-Za-z0-9_-]{1,16}$/;

/** Roles a SuperUser may hold in their hands: everyone on their vessel except GrandSuperUser. */
const VESSEL_ROLES = [ROLES.SUPER_USER, ROLES.ADMIN, ROLES.VIEWER];
const ALL_ROLES = [ROLES.GRAND_SUPER_USER, ...VESSEL_ROLES];

/**
 * May `actor` manage an account with this role and vessel?
 * - GrandSuperUser: every account on every vessel.
 * - SuperUser: SuperUser, Admin and Viewer accounts on their own vessel.
 * @param {{ role: string, vesselTag: string|null }} actor
 * @param {{ role: string, vesselTag: string|null }} account
 */
function canManage(actor, account) {
  if (isGlobalUser(actor)) return true;
  return (
    actor.role === ROLES.SUPER_USER &&
    Boolean(actor.vesselTag) &&
    account.vesselTag === actor.vesselTag &&
    VESSEL_ROLES.includes(account.role)
  );
}

function isSelf(actor, account) {
  return String(actor.username).toLowerCase() === String(account.username).toLowerCase();
}

/** @returns {string|null} error message, or null when the password is acceptable */
function passwordError(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > 72) return "Password must be at most 72 characters";
  return null;
}

/**
 * Work out the vessel tag an account gets.
 * GrandSuperUser accounts have none; a SuperUser can only place accounts on their own vessel.
 * @returns {{ vesselTag: string|null } | { error: string }}
 */
function resolveVesselTag(actor, role, requested) {
  if (role === ROLES.GRAND_SUPER_USER) return { vesselTag: null };
  if (!isGlobalUser(actor)) return { vesselTag: actor.vesselTag };
  const tag = typeof requested === "string" ? requested.trim() : "";
  if (!tag || tag.toUpperCase() === "ALL") return { error: "A vessel tag is required for this role" };
  if (!VESSEL_TAG_PATTERN.test(tag)) {
    return { error: "Vessel tag may only contain letters, numbers, hyphen and underscore (max 16)" };
  }
  return { vesselTag: tag };
}

/** Adds what the caller may do with the account, for the UI. */
function present(actor, user) {
  const self = isSelf(actor, user);
  const manageable = canManage(actor, user);
  return {
    ...user,
    isSelf: self,
    canEdit: manageable,
    // Nobody changes their own role or vessel, or deletes their own account.
    canChangeRole: manageable && !self,
    canDelete: manageable && !self,
  };
}

/**
 * Create users router (list, create, update, delete accounts).
 * @param {function} authMiddleware
 * @param {function} superUserOnly
 * @param {{ deleteSessionsForUser: function(string, string=): void }} sessionStore
 * @returns {express.Router}
 */
function createUsersRouter(authMiddleware, superUserOnly, sessionStore) {
  const router = express.Router();

  // GrandSuperUser sees every account; a SuperUser sees the accounts on their vessel.
  router.get("/api/users", authMiddleware, superUserOnly, async (req, res) => {
    try {
      await ensureUsersSeeded();
      const users = await listUsers(isGlobalUser(req.user) ? null : req.user.vesselTag);
      res.json({
        users: users.map((user) => present(req.user, user)),
        assignableRoles: isGlobalUser(req.user) ? ALL_ROLES : VESSEL_ROLES,
        canChooseVessel: isGlobalUser(req.user),
        ownVesselTag: req.user.vesselTag ?? null,
        minPasswordLength: MIN_PASSWORD_LENGTH,
      });
    } catch (err) {
      console.error("GET /api/users failed", err);
      sendError(res, 500, "Failed to list users");
    }
  });

  router.post("/api/users", authMiddleware, superUserOnly, async (req, res) => {
    try {
      await ensureUsersSeeded();
      const { username, password, role, vesselTag } = req.body || {};

      const name = typeof username === "string" ? username.trim() : "";
      if (!USERNAME_PATTERN.test(name)) {
        return sendError(res, 400, "Username must be 3-32 characters: letters, numbers, dot, hyphen or underscore");
      }
      const pwError = passwordError(password);
      if (pwError) return sendError(res, 400, pwError);
      if (!ALL_ROLES.includes(role)) return sendError(res, 400, "Unknown role");

      const vessel = resolveVesselTag(req.user, role, vesselTag);
      if (vessel.error) return sendError(res, 400, vessel.error);
      if (!canManage(req.user, { role, vesselTag: vessel.vesselTag })) {
        return sendError(res, 403, "You cannot create an account with this role");
      }

      const taken = await getOneCamelized("SELECT id FROM users WHERE username = ? COLLATE NOCASE", [name]);
      if (taken) return sendError(res, 409, `Username "${name}" is already in use`);

      const now = new Date().toISOString();
      const result = await runAsync(
        "INSERT INTO users (username, password_hash, role, vessel_tag, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [name, await bcrypt.hash(password, BCRYPT_COST), role, vessel.vesselTag, now, now, req.user.username]
      );
      res.status(201).json(present(req.user, await findUserById(result.lastID)));
    } catch (err) {
      console.error("POST /api/users failed", err);
      sendError(res, 500, "Failed to create user");
    }
  });

  // Change password, role and/or vessel. The username is fixed: events record it as "added by".
  router.put("/api/users/:id", authMiddleware, superUserOnly, async (req, res) => {
    const id = requireValidId(req, res);
    if (id === null) return;
    try {
      await ensureUsersSeeded();
      const target = await findUserById(id);
      // A SuperUser gets the same answer for an unknown id and an account outside their vessel.
      if (!target || !canManage(req.user, target)) {
        return sendError(res, target ? 403 : 404, target ? "You cannot manage this account" : "User not found");
      }

      const { password, role, vesselTag } = req.body || {};
      const self = isSelf(req.user, target);
      const setClauses = [];
      const params = [];

      if (password !== undefined && password !== null && password !== "") {
        const pwError = passwordError(password);
        if (pwError) return sendError(res, 400, pwError);
        setClauses.push("password_hash = ?");
        params.push(await bcrypt.hash(password, BCRYPT_COST));
      }

      const newRole = role !== undefined ? role : target.role;
      if (!ALL_ROLES.includes(newRole)) return sendError(res, 400, "Unknown role");

      // Keep the current vessel unless a new one is given (or the role makes it irrelevant).
      const requestedVessel = vesselTag !== undefined ? vesselTag : target.vesselTag;
      const vessel = resolveVesselTag(req.user, newRole, requestedVessel);
      if (vessel.error) return sendError(res, 400, vessel.error);

      const roleChanged = newRole !== target.role;
      const vesselChanged = vessel.vesselTag !== target.vesselTag;

      if (roleChanged || vesselChanged) {
        if (self) return sendError(res, 400, "You cannot change your own role or vessel");
        if (!canManage(req.user, { role: newRole, vesselTag: vessel.vesselTag })) {
          return sendError(res, 403, "You cannot assign this role");
        }
        if (target.role === ROLES.GRAND_SUPER_USER && roleChanged && (await countGrandSuperUsers()) <= 1) {
          return sendError(res, 400, "The last GrandSuperUser cannot be demoted");
        }
        setClauses.push("role = ?", "vessel_tag = ?");
        params.push(newRole, vessel.vesselTag);
      }

      if (setClauses.length === 0) {
        return sendError(res, 400, "Nothing to change: give a password, role or vessel tag");
      }

      setClauses.push("updated_at = ?");
      params.push(new Date().toISOString(), id);
      await runAsync(`UPDATE users SET ${setClauses.join(", ")} WHERE id = ?`, params);

      // Sessions carry the old role and vessel, and an old password must stop working:
      // log the account out everywhere. Someone changing their own password stays logged in here.
      const currentToken = self ? req.headers.authorization.slice(7) : undefined;
      sessionStore.deleteSessionsForUser(target.username, currentToken);

      res.json(present(req.user, await findUserById(id)));
    } catch (err) {
      console.error("PUT /api/users/:id failed", err);
      sendError(res, 500, "Failed to update user");
    }
  });

  router.delete("/api/users/:id", authMiddleware, superUserOnly, async (req, res) => {
    const id = requireValidId(req, res);
    if (id === null) return;
    try {
      await ensureUsersSeeded();
      const target = await findUserById(id);
      if (!target || !canManage(req.user, target)) {
        return sendError(res, target ? 403 : 404, target ? "You cannot manage this account" : "User not found");
      }
      if (isSelf(req.user, target)) return sendError(res, 400, "You cannot delete your own account");
      if (target.role === ROLES.GRAND_SUPER_USER && (await countGrandSuperUsers()) <= 1) {
        return sendError(res, 400, "The last GrandSuperUser cannot be deleted");
      }

      await runAsync("DELETE FROM users WHERE id = ?", [id]);
      sessionStore.deleteSessionsForUser(target.username);
      res.json({ success: true });
    } catch (err) {
      console.error("DELETE /api/users/:id failed", err);
      sendError(res, 500, "Failed to delete user");
    }
  });

  return router;
}

module.exports = { createUsersRouter, MIN_PASSWORD_LENGTH };
