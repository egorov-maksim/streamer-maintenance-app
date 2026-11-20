// db.js

const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const humps = require("humps");

const DB_FILE = process.env.DB_FILE
  ? path.resolve(process.cwd(), process.env.DB_FILE)
  : path.join(__dirname, "streamer.db");

const SCHEMA_FILE = path.join(__dirname, "schema.sql");
const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.cwd(), process.env.BACKUP_DIR)
  : path.join(__dirname, "..", "backup");
const MAX_BACKUPS = 14; // Keep last 14 backups (7 days worth at 12hr intervals)
const { stopBackupScheduler } = require("./backupScheduler");

if (!fs.existsSync(path.dirname(DB_FILE))) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
}

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_FILE);

/**
 * @param {(() => void)|undefined} onReady - Called after the schema and all migrations are applied
 *   (e.g. start backup scheduler).
 */
function initDb(onReady) {
  db.serialize(() => {
    db.run("PRAGMA foreign_keys = ON;");
    db.run("PRAGMA journal_mode = WAL;");

    const schema = fs.readFileSync(SCHEMA_FILE, "utf8");
    db.exec(schema, (err) => {
      if (err) {
        console.error("Error applying schema:", err);
      } else {
        console.log("Database schema applied.");
        applyMigrations().then(() => {
          if (typeof onReady === "function") {
            onReady();
          }
        });
      }
    });
  });
}

/**
 * Columns added after a table was first released. Each is added only when missing, so this
 * is safe to run on every startup.
 */
const COLUMN_MIGRATIONS = [
  { table: "projects", column: "suggested_cleaning_threshold_days", definition: "INTEGER DEFAULT 10" },
  // Per-streamer section count override (longer cables in a project)
  { table: "streamer_deployments", column: "sections_per_cable", definition: "INTEGER" },
  // Water speed fields recorded at the time of RMS noise line acquisition
  { table: "noise_uploads", column: "water_speed_start", definition: "REAL" },
  { table: "noise_uploads", column: "water_speed_end", definition: "REAL" },
  // Time the noise sequence was recorded; upload time is used when it is missing.
  { table: "noise_uploads", column: "recorded_at", definition: "TEXT" },
];

/**
 * Apply incremental schema migrations for databases created before a new column was added.
 * Resolves once every migration has finished, so callers can wait before touching the
 * database (the startup backup must not run while a table is being altered).
 * A failed migration is logged and the rest still run.
 * @returns {Promise<void>}
 */
async function applyMigrations() {
  for (const { table, column, definition } of COLUMN_MIGRATIONS) {
    try {
      const columns = await allAsync(`PRAGMA table_info(${table})`);
      if (columns.some((col) => col.name === column)) continue;
      await runAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`Migration applied: added ${column} to ${table}`);
    } catch (err) {
      console.error(`Migration failed (add ${column} to ${table}):`, err);
    }
  }
  try {
    await migrateUsersRoleCheck();
  } catch (err) {
    console.error("Migration failed (users role check):", err);
  }
}

const USERS_COLUMNS =
  "id, username, password_hash, role, vessel_tag, created_at, updated_at, created_by";

/**
 * SQLite cannot alter a CHECK constraint, so a users table created before the supervisor
 * role existed is rebuilt: new table, copy rows (ids kept), drop old, rename. Skipped when
 * the stored DDL already allows 'supervisor'.
 * @returns {Promise<void>}
 */
async function migrateUsersRoleCheck() {
  const row = await getAsync("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'");
  if (!row || !row.sql || row.sql.includes("'supervisor'")) return;
  await execAtomic([
    "DROP TABLE IF EXISTS users_new",
    `CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('grandsuperuser', 'superuser', 'admin', 'supervisor', 'viewer')),
      vessel_tag TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT
    )`,
    `INSERT INTO users_new (${USERS_COLUMNS}) SELECT ${USERS_COLUMNS} FROM users`,
    "DROP TABLE users",
    "ALTER TABLE users_new RENAME TO users",
  ]);
  console.log("Migration applied: users.role now allows supervisor");
}

/**
 * Creates a backup of the database file with timestamp
 */
function createBackup() {
  return new Promise((resolve, reject) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFileName = `streamer_backup_${timestamp}.db`;
    const backupPath = path.join(BACKUP_DIR, backupFileName);

    // Use SQLite backup API via checkpoint to ensure WAL is flushed
    db.run("PRAGMA wal_checkpoint(TRUNCATE);", (err) => {
      if (err) {
        console.error("WAL checkpoint failed:", err);
        // Continue with backup anyway
      }

      try {
        // Copy the main database file
        fs.copyFileSync(DB_FILE, backupPath);
        console.log(`Database backup created: ${backupFileName}`);
        
        // Clean up old backups
        cleanupOldBackups();
        
        resolve(backupPath);
      } catch (copyErr) {
        console.error("Backup failed:", copyErr);
        reject(copyErr);
      }
    });
  });
}

/**
 * Replaces the contents of the live database with the contents of a backup file,
 * using SQLite's online backup API on the open connection. Unlike copying the file
 * over DB_FILE, this is safe while the server is running: the connection's page
 * cache and WAL stay consistent, and no restart is needed.
 * @param {string} sourcePath - Path to a SQLite database file to restore from
 * @returns {Promise<void>}
 */
function restoreFromFile(sourcePath) {
  return copyBackupIntoLiveDb(sourcePath).then(applySchemaAndMigrations);
}

/**
 * Bring a just-restored database up to the current schema. A backup taken by an older
 * version can lack tables or columns the running code needs (e.g. the users table).
 * @returns {Promise<void>}
 */
function applySchemaAndMigrations() {
  return new Promise((resolve, reject) => {
    db.exec(fs.readFileSync(SCHEMA_FILE, "utf8"), (err) => {
      if (err) return reject(err);
      applyMigrations().then(resolve, reject);
    });
  });
}

function copyBackupIntoLiveDb(sourcePath) {
  return new Promise((resolve, reject) => {
    // filenameIsDest=false: copy sourcePath's "main" schema INTO this connection's "main".
    const backup = db.backup(sourcePath, "main", "main", false, (initErr) => {
      if (initErr) return reject(initErr);
      backup.step(-1, (stepErr) => {
        backup.finish((finishErr) => {
          const err = stepErr || finishErr;
          if (err) return reject(err);
          resolve();
        });
      });
    });
  });
}

/**
 * Removes old backups keeping only the most recent MAX_BACKUPS
 */
function cleanupOldBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((filename) => filename.startsWith("streamer_backup_") && filename.endsWith(".db"))
      .map((filename) => ({
        name: filename,
        path: path.join(BACKUP_DIR, filename),
        mtime: fs.statSync(path.join(BACKUP_DIR, filename)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime); // Newest first

    // Remove backups beyond MAX_BACKUPS
    if (files.length > MAX_BACKUPS) {
      const toDelete = files.slice(MAX_BACKUPS);
      for (const file of toDelete) {
        fs.unlinkSync(file.path);
        console.log(`Deleted old backup: ${file.name}`);
      }
    }
  } catch (err) {
    console.error("Error cleaning up old backups:", err);
  }
}

/**
 * Run a SQL statement (INSERT/UPDATE/DELETE).
 * @param {string} sql - SQL statement
 * @param {Array} [params=[]] - Query parameters
 * @returns {Promise<{ lastID: number, changes: number }>}
 */
function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

/**
 * Renders a validated scalar as a SQL literal for use in execAtomic scripts.
 * Only finite numbers, strings and null are accepted; anything else throws so a
 * caller can never splice unchecked input into SQL.
 * @param {number|string|null} value
 * @returns {string}
 */
function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("sqlLiteral: number must be finite");
    return String(value);
  }
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  throw new TypeError(`sqlLiteral: unsupported value type ${typeof value}`);
}

/**
 * Runs several statements as ONE atomic unit on the shared connection.
 *
 * node-sqlite3 queues every statement from every request on a single connection,
 * so an `await` between BEGIN and COMMIT lets other requests' writes slip inside
 * the transaction (and get rolled back with it). Sending the whole script to a
 * single db.exec call closes that window: it is one queued operation, and SQLite
 * either commits all of it or none of it.
 *
 * Statements must already contain their values as literals (see sqlLiteral);
 * exec does not take bound parameters.
 * @param {string[]} statements - Complete SQL statements (trailing ';' optional)
 * @returns {Promise<void>}
 */
function execAtomic(statements) {
  const body = statements.map((stmt) => stmt.trim().replace(/;*$/, ";"));
  const script = ["BEGIN IMMEDIATE;", ...body, "COMMIT;"].join("\n");
  return new Promise((resolve, reject) => {
    db.exec(script, (err) => {
      if (!err) return resolve();
      // The failing statement leaves the transaction open; undo it before reporting.
      db.exec("ROLLBACK;", () => reject(err));
    });
  });
}

/**
 * Run a SELECT and return all rows (raw, snake_case).
 * @param {string} sql - SQL query
 * @param {Array} [params=[]] - Query parameters
 * @returns {Promise<Array<Object>>}
 */
function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

/**
 * Run a SELECT and return first row (raw, snake_case).
 * @param {string} sql - SQL query
 * @param {Array} [params=[]] - Query parameters
 * @returns {Promise<Object|undefined>}
 */
function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

/**
 * Run a SELECT and return all rows with keys camelized.
 * @param {string} sql - SQL query
 * @param {Array} [params=[]] - Query parameters
 * @returns {Promise<Array<Object>>}
 */
async function getAllCamelized(sql, params = []) {
  const rows = await allAsync(sql, params);
  return rows.map(row => humps.camelizeKeys(row));
}

/**
 * Run a SELECT and return first row with keys camelized, or null.
 * @param {string} sql - SQL query
 * @param {Array} [params=[]] - Query parameters
 * @returns {Promise<Object|null>}
 */
async function getOneCamelized(sql, params = []) {
  const row = await getAsync(sql, params);
  return row ? humps.camelizeKeys(row) : null;
}

process.on("SIGINT", () => {
  stopBackupScheduler();
  db.close();
  process.exit(0);
});

module.exports = {
  db,
  initDb,
  createBackup,
  restoreFromFile,
  applyMigrations,
  execAtomic,
  sqlLiteral,
  runAsync,
  allAsync,
  getAsync,
  getAllCamelized,
  getOneCamelized,
  DB_FILE,
  BACKUP_DIR,
};
