// routes/backups.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const humps = require("humps");
const { createBackup, BACKUP_DIR, DB_FILE } = require("../db");
const { sendError } = require("../utils/errors");
const { isGlobalUser } = require("../middleware/auth");

/**
 * Create backups router (list, create, restore).
 * @param {function} authMiddleware
 * @param {function} superUserOnly
 * @returns {express.Router}
 */
function createBackupsRouter(authMiddleware, superUserOnly) {
  const router = express.Router();

  router.get("/api/backups", authMiddleware, superUserOnly, async (_req, res) => {
    try {
      if (!fs.existsSync(BACKUP_DIR)) {
        return res.json({ backups: [] });
      }

      const files = fs
        .readdirSync(BACKUP_DIR)
        .filter((f) => f.startsWith("streamer_backup_") && f.endsWith(".db"))
        .map((f) => {
          const filePath = path.join(BACKUP_DIR, f);
          const stats = fs.statSync(filePath);
          return humps.camelizeKeys({
            filename: f,
            size: stats.size,
            created_at: stats.mtime.toISOString(),
          });
        })
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      res.json({ backups: files });
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to list backups");
    }
  });

  router.post("/api/backups", authMiddleware, superUserOnly, async (_req, res) => {
    try {
      const backupPath = await createBackup();
      res.json({ success: true, path: backupPath });
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to create backup");
    }
  });

  router.post("/api/backups/:filename/restore", authMiddleware, superUserOnly, async (req, res) => {
    try {
      const { filename } = req.params;

      // Restoring a backup replaces the entire database; restrict to global superusers.
      if (!isGlobalUser(req.user)) {
        return sendError(res, 403, "Grand SuperUser access required to restore backups");
      }
      const backupPath = path.join(BACKUP_DIR, filename);

      if (!filename.startsWith("streamer_backup_") || !filename.endsWith(".db") || filename.includes("..")) {
        return sendError(res, 400, "Invalid backup filename");
      }

      if (!fs.existsSync(backupPath)) {
        return sendError(res, 404, "Backup file not found");
      }

      if (process.env.NODE_ENV !== "test") {
        await createBackup();
        fs.copyFileSync(backupPath, DB_FILE);
      }

      res.json({
        success: true,
        message: "Database restored successfully. Please restart the server for changes to take effect.",
        restoredFrom: filename,
      });
    } catch (err) {
      console.error(err);
      sendError(res, 500, "Failed to restore backup");
    }
  });

  return router;
}

module.exports = { createBackupsRouter };
