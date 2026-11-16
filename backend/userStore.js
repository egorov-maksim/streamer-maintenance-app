// userStore.js — user accounts in the database (managed from the Config page).

const { runAsync, getAsync, getAllCamelized, getOneCamelized } = require("./db");
const { ROLES, loadUsersFromEnv } = require("./middleware/auth");

/**
 * Copy the users from AUTH_USERS into the database when it holds no users yet:
 * a fresh install, the first start after upgrading from .env-only users, or a restored
 * backup taken before users were stored in the database. Password hashes are copied as
 * they are, so everyone keeps their current password. Once the table has users,
 * AUTH_USERS is ignored and accounts are managed in the app.
 *
 * @returns {Promise<number>} number of users imported (0 when the table already had users)
 */
async function seedUsersFromEnv() {
  const existing = await getAsync("SELECT COUNT(*) AS n FROM users");
  if (existing.n > 0) return 0;

  const envUsers = loadUsersFromEnv();
  const now = new Date().toISOString();
  let imported = 0;
  for (const [username, user] of Object.entries(envUsers)) {
    try {
      await runAsync(
        "INSERT INTO users (username, password_hash, role, vessel_tag, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [username, user.password, user.role, user.vesselTag, now, now, "AUTH_USERS"]
      );
      imported++;
    } catch (err) {
      console.warn(`[auth] Could not import AUTH_USERS entry for "${username}": ${err.message}`);
    }
  }
  if (imported > 0) {
    console.log(`[auth] Imported ${imported} user(s) from AUTH_USERS into the database.`);
  } else {
    console.warn("[auth] No users in the database and none could be imported from AUTH_USERS; nobody can log in.");
  }
  return imported;
}

let seedPromise = null;

/** Seed once per process; later calls reuse the same result. */
function ensureUsersSeeded() {
  if (!seedPromise) {
    seedPromise = seedUsersFromEnv().catch((err) => {
      seedPromise = null;
      throw err;
    });
  }
  return seedPromise;
}

/** Run the seed check again (after a restore replaced the database, or in tests). */
async function reseedUsers() {
  // Let a seed that is already running finish first, so two never interleave.
  if (seedPromise) await seedPromise.catch(() => {});
  seedPromise = null;
  return ensureUsersSeeded();
}

/** Full row including the password hash — for login only. Usernames match case-insensitively. */
function findUserForLogin(username) {
  return getOneCamelized("SELECT * FROM users WHERE username = ? COLLATE NOCASE", [username]);
}

const PUBLIC_COLUMNS = "id, username, role, vessel_tag, created_at, updated_at, created_by";

/** User without the password hash. */
function findUserById(id) {
  return getOneCamelized(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`, [id]);
}

/**
 * Users without password hashes, optionally limited to one vessel.
 * @param {string|null} vesselTag - null lists every user
 */
function listUsers(vesselTag = null) {
  const where = vesselTag ? " WHERE vessel_tag = ?" : "";
  return getAllCamelized(
    `SELECT ${PUBLIC_COLUMNS} FROM users${where} ORDER BY vessel_tag IS NOT NULL, vessel_tag COLLATE NOCASE, username COLLATE NOCASE`,
    vesselTag ? [vesselTag] : []
  );
}

async function countGrandSuperUsers() {
  const row = await getAsync("SELECT COUNT(*) AS n FROM users WHERE role = ?", [ROLES.GRAND_SUPER_USER]);
  return row.n;
}

module.exports = {
  seedUsersFromEnv,
  ensureUsersSeeded,
  reseedUsers,
  findUserForLogin,
  findUserById,
  listUsers,
  countGrandSuperUsers,
};
