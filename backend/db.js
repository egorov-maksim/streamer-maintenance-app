// db.js

const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");

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

/**
 * Initialize the database by applying the schema from schema.sql
 * This function sets up PRAGMA settings, applies the complete schema,
 * and starts the automated backup scheduler.
 */
function initDb() {
  db.serialize(() => {
    // Enable foreign key constraints and WAL mode
    // Note: These are also in schema.sql, but we set them here for safety
    db.run("PRAGMA foreign_keys = ON;");
    db.run("PRAGMA journal_mode = WAL;");

    // Read and execute the complete schema
    const schema = fs.readFileSync(SCHEMA_FILE, "utf8");
    db.exec(schema, (err) => {
      if (err) {
        console.error("Error applying schema:", err);
        process.exit(1);
      } else {
        console.log("Database schema ensured.");
      }
    });
  });

  // Start automated backup scheduler
  startBackupScheduler();
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

process.on("SIGINT", () => {
  stopBackupScheduler();
  db.close();
  process.exit(0);
});

module.exports = { db, initDb, createBackup, stopBackupScheduler };
