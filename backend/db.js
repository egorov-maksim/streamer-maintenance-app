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

function initDb() {
  db.serialize(() => {
    db.run("PRAGMA foreign_keys = ON;");
    db.run("PRAGMA journal_mode = WAL;");

    const schema = fs.readFileSync(SCHEMA_FILE, "utf8");
    db.exec(schema, (err) => {
      if (err) {
        console.error("Error applying schema:", err);
      } else {
        console.log("Database schema ensured.");
        // Run migrations for existing databases
        migrateDatabase();
      }
    });
  });

  // Start automated backup scheduler
  startBackupScheduler();
}

/**
 * Migrate existing database to add new columns if they don't exist
 */
function migrateDatabase() {
  // Migrate cleaning_events table
  migrateCleaningEvents();
  
  // Migrate projects table to add streamer config columns
  migrateProjectsTable();
}

/**
 * Migrate cleaning_events table
 */
function migrateCleaningEvents() {
  db.all("PRAGMA table_info(cleaning_events)", (err, columns) => {
    if (err) {
      console.error("Error checking cleaning_events table info:", err);
      return;
    }
    
    const columnNames = columns.map(c => c.name);
    let migrationsNeeded = 0;
    let migrationsComplete = 0;
    
    const checkAndCreateIndex = () => {
      migrationsComplete++;
      if (migrationsComplete >= migrationsNeeded) {
        db.run("CREATE INDEX IF NOT EXISTS idx_cleaning_events_project ON cleaning_events (project_number)", (err) => {
          if (err && !err.message.includes('already exists')) {
            console.error("Failed to create project index:", err);
          } else {
            console.log("Project index ensured on cleaning_events");
          }
        });
      }
    };
    
    if (!columnNames.includes('project_number')) {
      migrationsNeeded++;
      db.run("ALTER TABLE cleaning_events ADD COLUMN project_number TEXT", (err) => {
        if (err) {
          console.error("Failed to add project_number column:", err);
        } else {
          console.log("Added project_number column to cleaning_events");
        }
        checkAndCreateIndex();
      });
    }
    
    if (!columnNames.includes('vessel_tag')) {
      migrationsNeeded++;
      db.run("ALTER TABLE cleaning_events ADD COLUMN vessel_tag TEXT DEFAULT 'TTN'", (err) => {
        if (err) {
          console.error("Failed to add vessel_tag column:", err);
        } else {
          console.log("Added vessel_tag column to cleaning_events");
        }
        checkAndCreateIndex();
      });
    }
    
    if (columnNames.includes('project_number')) {
      db.run("CREATE INDEX IF NOT EXISTS idx_cleaning_events_project ON cleaning_events (project_number)", (err) => {
        if (err && !err.message.includes('already exists')) {
          console.error("Failed to create project index:", err);
        }
      });
    }
  });
}

/**
 * Migrate projects table to add streamer configuration columns
 */
function migrateProjectsTable() {
  db.all("PRAGMA table_info(projects)", (err, columns) => {
    if (err) {
      console.error("Error checking projects table info:", err);
      return;
    }
    
    const columnNames = columns.map(c => c.name);
    
    const configColumns = [
      { name: 'num_cables', sql: 'ALTER TABLE projects ADD COLUMN num_cables INTEGER DEFAULT 12' },
      { name: 'sections_per_cable', sql: 'ALTER TABLE projects ADD COLUMN sections_per_cable INTEGER DEFAULT 107' },
      { name: 'section_length', sql: 'ALTER TABLE projects ADD COLUMN section_length INTEGER DEFAULT 75' },
      { name: 'module_frequency', sql: 'ALTER TABLE projects ADD COLUMN module_frequency INTEGER DEFAULT 4' },
      { name: 'channels_per_section', sql: 'ALTER TABLE projects ADD COLUMN channels_per_section INTEGER DEFAULT 6' },
      { name: 'use_rope_for_tail', sql: 'ALTER TABLE projects ADD COLUMN use_rope_for_tail INTEGER DEFAULT 1' },
    ];
    
    for (const col of configColumns) {
      if (!columnNames.includes(col.name)) {
        db.run(col.sql, (err) => {
          if (err) {
            console.error(`Failed to add ${col.name} column to projects:`, err);
          } else {
            console.log(`Added ${col.name} column to projects table`);
          }
        });
      }
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
