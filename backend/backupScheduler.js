// backupScheduler.js — Periodic SQLite file backups (setInterval), separate from db query helpers.

const BACKUP_INTERVAL_MS = 12 * 60 * 60 * 1000;

let backupInterval = null;

/**
 * @param {() => Promise<unknown>} createBackup - db.createBackup
 */
function startBackupScheduler(createBackup) {
  console.log("Starting automated database backup scheduler (every 12 hours)");
  createBackup().catch((err) => console.error("Initial backup failed:", err));
  backupInterval = setInterval(() => {
    console.log("Running scheduled database backup...");
    createBackup().catch((err) => console.error("Scheduled backup failed:", err));
  }, BACKUP_INTERVAL_MS);
}

function stopBackupScheduler() {
  if (backupInterval) {
    clearInterval(backupInterval);
    backupInterval = null;
    console.log("Backup scheduler stopped.");
  }
}

module.exports = { startBackupScheduler, stopBackupScheduler, BACKUP_INTERVAL_MS };
