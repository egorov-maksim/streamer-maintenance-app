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
const BACKUP_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours in milliseconds
const MAX_BACKUPS = 14; // Keep last 14 backups (7 days worth at 12hr intervals)

if (!fs.existsSync(path.dirname(DB_FILE))) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
}

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_FILE);

function initDb() {
  db.serialize(() => {
    db.run("PRAGMA foreign_keys = ON;");
    db.run("PRAGMA journal_mode = WAL;");

    const schema = fs.readFileSync(SCHEMA_FILE, "utf8");
    db.exec(schema, (err) => {
      if (err) {
        console.error("Error applying schema:", err);
      } else {
        console.log("Database schema applied.");
        if (process.env.NODE_ENV !== "test") {
          startBackupScheduler();
        }
      }
    });
  });
}

// No migration functions - fresh install only

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
      .filter(f => f.startsWith("streamer_backup_") && f.endsWith(".db"))
      .map(f => ({
        name: f,
        path: path.join(BACKUP_DIR, f),
        mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime
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

let backupInterval = null;

/**
 * Starts the automated backup scheduler (every 12 hours)
 */
function startBackupScheduler() {
  // Create an initial backup on startup
  console.log("Starting automated database backup scheduler (every 12 hours)");
  createBackup().catch(err => console.error("Initial backup failed:", err));

  // Schedule backups every 12 hours
  backupInterval = setInterval(() => {
    console.log("Running scheduled database backup...");
    createBackup().catch(err => console.error("Scheduled backup failed:", err));
  }, BACKUP_INTERVAL_MS);
}

/**
 * Stops the backup scheduler
 */
function stopBackupScheduler() {
  if (backupInterval) {
    clearInterval(backupInterval);
    backupInterval = null;
    console.log("Backup scheduler stopped.");
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
  stopBackupScheduler,
  runAsync,
  allAsync,
  getAsync,
  getAllCamelized,
  getOneCamelized,
  DB_FILE,
  BACKUP_DIR,
};
