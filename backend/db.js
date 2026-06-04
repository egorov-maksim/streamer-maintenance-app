// db.js

const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const humps = require("humps");

const DB_FILE = process.env.DB_FILE
  ? path.resolve(process.cwd(), process.env.DB_FILE)
  : path.join(__dirname, "streamer.db");

const SCHEMA_FILE = path.join(__dirname, "schema.sql");
const BACKUP_DIR = path.join(__dirname, "..", "backup");
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
 * @param {(() => void)|undefined} onReady - Called after schema is applied (e.g. start backup scheduler).
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
        applyMigrations();
        if (typeof onReady === "function") {
          onReady();
        }
      }
    });
  });
}

/**
 * Apply incremental schema migrations for databases created before a new column was added.
 * Each migration checks for the column's absence before altering the table, so it is safe
 * to run on every startup without risking duplicate-column errors.
 */
function applyMigrations() {
  db.all("PRAGMA table_info(projects)", [], (err, columns) => {
    if (err) { console.error("Migration check failed:", err); return; }
    const hasThreshold = columns.some((col) => col.name === "suggested_cleaning_threshold_days");
    if (!hasThreshold) {
      db.run(
        "ALTER TABLE projects ADD COLUMN suggested_cleaning_threshold_days INTEGER DEFAULT 10",
        (migrErr) => {
          if (migrErr) console.error("Migration failed (add suggested_cleaning_threshold_days):", migrErr);
          else console.log("Migration applied: added suggested_cleaning_threshold_days to projects");
        }
      );
    }
  });

  // Per-streamer section count override (longer cables in a project)
  db.all("PRAGMA table_info(streamer_deployments)", [], (err, columns) => {
    if (err) { console.error("Migration check failed (streamer_deployments):", err); return; }
    if (!columns.some((col) => col.name === "sections_per_cable")) {
      db.run(
        "ALTER TABLE streamer_deployments ADD COLUMN sections_per_cable INTEGER",
        (migrErr) => {
          if (migrErr) console.error("Migration failed (add sections_per_cable to streamer_deployments):", migrErr);
          else console.log("Migration applied: added sections_per_cable to streamer_deployments");
        }
      );
    }
  });

  // Water speed fields recorded at the time of RMS noise line acquisition
  db.all("PRAGMA table_info(noise_uploads)", [], (err, columns) => {
    if (err) { console.error("Migration check failed (noise_uploads):", err); return; }
    const names = columns.map((col) => col.name);
    if (!names.includes("water_speed_start")) {
      db.run(
        "ALTER TABLE noise_uploads ADD COLUMN water_speed_start REAL",
        (migrErr) => {
          if (migrErr) console.error("Migration failed (add water_speed_start):", migrErr);
          else console.log("Migration applied: added water_speed_start to noise_uploads");
        }
      );
    }
    if (!names.includes("water_speed_end")) {
      db.run(
        "ALTER TABLE noise_uploads ADD COLUMN water_speed_end REAL",
        (migrErr) => {
          if (migrErr) console.error("Migration failed (add water_speed_end):", migrErr);
          else console.log("Migration applied: added water_speed_end to noise_uploads");
        }
      );
    }
  });
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
  runAsync,
  allAsync,
  getAsync,
  getAllCamelized,
  getOneCamelized,
  DB_FILE,
  BACKUP_DIR,
};
