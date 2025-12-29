// db.js

const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");

const DB_FILE = process.env.DB_FILE
  ? path.resolve(process.cwd(), process.env.DB_FILE)
  : path.join(__dirname, "streamer.db");

const SCHEMA_FILE = path.join(__dirname, "schema.sql");

if (!fs.existsSync(path.dirname(DB_FILE))) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
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
      }
    });
  });
}

process.on("SIGINT", () => {
  db.close();
  process.exit(0);
});

module.exports = { db, initDb };
