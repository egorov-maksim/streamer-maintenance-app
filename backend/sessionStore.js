// sessionStore.js — In-memory Bearer token sessions with TTL for the internal vessel app (no express-session).

const DEFAULT_SESSION_TTL_MS = 28800000; // 8 hours

function parseSessionTtlMs() {
  const raw = process.env.SESSION_TTL_MS;
  if (raw == null || String(raw).trim() === "") return DEFAULT_SESSION_TTL_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SESSION_TTL_MS;
}

/**
 * Factory for the in-memory Bearer session map with TTL eviction (internal tool; no Redis).
 * Limits how long a stolen token remains valid without restarting the process.
 *
 * @returns {{ getSession: function(string): Object|null, setSession: function(string,
 *   { username: string, role: string, vesselTag: string|null, isGlobal: boolean }): void,
 *   deleteSession: function(string): void,
 *   deleteSessionsForUser: function(string, string=): void,
 *   deleteAllSessions: function(string=): void }}
 */
function createSessionStore() {
  /** @type {Map<string, { username: string, role: string, vesselTag: string|null, isGlobal: boolean, expiresAt: number }>} */
  const sessions = new Map();

  function getSession(token) {
    const entry = sessions.get(token);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      sessions.delete(token);
      return null;
    }
    return {
      username: entry.username,
      role: entry.role,
      vesselTag: entry.vesselTag ?? null,
      isGlobal: Boolean(entry.isGlobal),
    };
  }

  function setSession(token, payload) {
    const ttlMs = parseSessionTtlMs();
    sessions.set(token, {
      username: payload.username,
      role: payload.role,
      vesselTag: payload.vesselTag ?? null,
      isGlobal: Boolean(payload.isGlobal),
      expiresAt: Date.now() + ttlMs,
    });
  }

  function deleteSession(token) {
    sessions.delete(token);
  }

  /**
   * Log a user out everywhere (account deleted, or its password, role or vessel changed).
   * @param {string} username - matched case-insensitively, like login
   * @param {string} [exceptToken] - a session to keep (the caller's own)
   */
  function deleteSessionsForUser(username, exceptToken) {
    const wanted = String(username).toLowerCase();
    for (const [token, entry] of sessions) {
      if (token !== exceptToken && String(entry.username).toLowerCase() === wanted) sessions.delete(token);
    }
  }

  /**
   * Drop every session (the database was replaced by a restore, so accounts may differ).
   * @param {string} [exceptToken] - a session to keep (the caller's own)
   */
  function deleteAllSessions(exceptToken) {
    for (const token of [...sessions.keys()]) {
      if (token !== exceptToken) sessions.delete(token);
    }
  }

  return { getSession, setSession, deleteSession, deleteSessionsForUser, deleteAllSessions };
}

module.exports = { createSessionStore, DEFAULT_SESSION_TTL_MS };
