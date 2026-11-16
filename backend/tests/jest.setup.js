// Jest environment bootstrap — runs before every test file, before any require of db.js.
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");

const worker = process.env.JEST_WORKER_ID || "1";
const scratchRoot = path.join(__dirname, ".scratch");
fs.mkdirSync(scratchRoot, { recursive: true });

process.env.NODE_ENV = "test";
process.env.DB_FILE = path.join(scratchRoot, `test-w${worker}.db`);
process.env.BACKUP_DIR = path.join(scratchRoot, `backup-w${worker}`);
process.env.SESSION_TTL_MS = String(60 * 60 * 1000);

// Low bcrypt cost keeps login fast in tests; format is USERNAME:HASH:ROLE:VESSEL_TAG.
const hash = bcrypt.hashSync("test-password", 4);
process.env.TEST_PASSWORD = "test-password";
process.env.AUTH_USERS = [
  `grand:${hash}:grandsuperuser:ALL`,
  `ttnsuper:${hash}:superuser:TTN`,
  `ttnadmin:${hash}:admin:TTN`,
  `ttnviewer:${hash}:viewer:TTN`,
  `ramadmin:${hash}:admin:RAM`,
].join(",");

// Start every test file from an empty database so suites are order-independent.
for (const suffix of ["", "-wal", "-shm"]) {
  try { fs.unlinkSync(process.env.DB_FILE + suffix); } catch { /* not present */ }
}
fs.rmSync(process.env.BACKUP_DIR, { recursive: true, force: true });
