const { ready } = require("./helpers/app");
const { ensureUsersSeeded } = require("../userStore");
const { runAsync, getAsync, allAsync, applyMigrations } = require("../db");

const OLD_USERS_DDL = `CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('grandsuperuser', 'superuser', 'admin', 'viewer')),
  vessel_tag TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT
)`;

const insertUser = (id, username, role, vesselTag) =>
  runAsync(
    `INSERT INTO users (id, username, password_hash, role, vessel_tag, created_at, updated_at)
     VALUES (?, ?, 'x', ?, ?, 'now', 'now')`,
    [id, username, role, vesselTag]
  );

describe("users.role CHECK migration", () => {
  beforeAll(async () => {
    await ready();
    await ensureUsersSeeded(); // let the startup seed finish before the table is swapped
    await runAsync("DROP TABLE users");
    await runAsync(OLD_USERS_DDL);
    await insertUser(7, "grand1", "grandsuperuser", null);
    await insertUser(9, "v1", "viewer", "TTN");
    await applyMigrations();
  });

  it("rebuilds an old users table, keeps ids and rows", async () => {
    const rows = await allAsync("SELECT id, username, role, vessel_tag FROM users WHERE id IN (7, 9) ORDER BY id");
    expect(rows).toEqual([
      { id: 7, username: "grand1", role: "grandsuperuser", vessel_tag: null },
      { id: 9, username: "v1", role: "viewer", vessel_tag: "TTN" },
    ]);
    await insertUser(11, "sup1", "supervisor", null);
    expect((await getAsync("SELECT role FROM users WHERE id = 11")).role).toBe("supervisor");
    await expect(insertUser(12, "bad", "bogus", null)).rejects.toThrow(/CHECK/);
  });

  it("is idempotent", async () => {
    const before = await getAsync("SELECT COUNT(*) AS n FROM users");
    await applyMigrations();
    await applyMigrations();
    const after = await getAsync("SELECT COUNT(*) AS n FROM users");
    expect(after.n).toBe(before.n);
  });

  it("keeps usernames case-insensitively unique", async () => {
    await expect(insertUser(13, "V1", "viewer", "TTN")).rejects.toThrow(/UNIQUE/);
  });
});
