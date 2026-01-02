
// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const { db, initDb } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
initDb();

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'", 
        "https://cdnjs.cloudflare.com"  // Allow jsPDF CDN
      ],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

const allowed = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowed.includes(origin)) cb(null, true);
      else cb(new Error("Not allowed by CORS"));
    },
  })
);

app.use(express.json());
// serve frontend
app.use(express.static(path.join(__dirname, "..", "public")));

// sqlite helpers
function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}
function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}
function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// defaults
const defaultConfig = {
  numCables: 12,
  sectionsPerCable: 107,
  sectionLength: 25,
  moduleFrequency: 4,
  useRopeForTail: true,     // true = rope (no tails), false = add 5 tails
  channelsPerSection: 6,
};

// config helpers
async function loadConfig() {
  const rows = await allAsync("SELECT key, value FROM app_config");
  const cfg = { ...defaultConfig };
  for (const row of rows) {
    const v = row.value;
    cfg[row.key] =
      v === "true" ? true :
      v === "false" ? false :
      Number.isFinite(Number(v)) ? Number(v) : v;
  }
  return cfg;
}
async function saveConfig(partial = {}) {
  const keys = Object.keys(partial);
  for (const key of keys) {
    const value = String(partial[key]);
    await runAsync(
      "INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value]
    );
  }
}
function toInt(n, fallback) {
  const v = Number.parseInt(n, 10);
  return Number.isFinite(v) ? v : fallback;
}
function requireValidId(req, res) {
  const id = toInt(req.params.id, NaN);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return null;
  }
  return id;
}

// ---- endpoints ----
app.get("/api/config", async (_req, res) => {
  try {
    const cfg = await loadConfig();
    res.json(cfg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load config" });
  }
});

app.put("/api/config", async (req, res) => {
  try {
    const partial = {
      numCables: toInt(req.body?.numCables, defaultConfig.numCables),
      sectionsPerCable: toInt(req.body?.sectionsPerCable, defaultConfig.sectionsPerCable),
      sectionLength: toInt(req.body?.sectionLength, defaultConfig.sectionLength),
      moduleFrequency: toInt(req.body?.moduleFrequency, defaultConfig.moduleFrequency),
      useRopeForTail: Boolean(req.body?.useRopeForTail),
      channelsPerSection: toInt(req.body?.channelsPerSection, defaultConfig.channelsPerSection),
    };
    await saveConfig(partial);
    const cfg = await loadConfig();
    res.json(cfg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save config" });
  }
});

app.get("/api/events", async (_req, res) => {
  try {
    const rows = await allAsync("SELECT * FROM cleaning_events ORDER BY datetime(cleaned_at) DESC");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

app.post("/api/events", async (req, res) => {
  try {
    const { cable_id, section_index_start, section_index_end, cleaning_method, cleaned_at, cleaning_count } = req.body;
    if (
      typeof cable_id !== "string" ||
      !Number.isFinite(section_index_start) ||
      !Number.isFinite(section_index_end) ||
      typeof cleaning_method !== "string" ||
      typeof cleaned_at !== "string"
    ) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    const result = await runAsync(
      `INSERT INTO cleaning_events (cable_id, section_index_start, section_index_end, cleaning_method, cleaned_at, cleaning_count)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [cable_id, section_index_start, section_index_end, cleaning_method, cleaned_at, Number.isFinite(cleaning_count) ? cleaning_count : 1]
    );
    const created = await getAsync("SELECT * FROM cleaning_events WHERE id = ?", [result.lastID]);
    res.json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create event" });
  }
});

app.put("/api/events/:id", async (req, res) => {
  try {
    const id = requireValidId(req, res);
    if (id === null) return;

    const { cable_id, section_index_start, section_index_end, cleaning_method, cleaned_at, cleaning_count } = req.body;
    if (
      typeof cable_id !== "string" ||
      !Number.isFinite(section_index_start) ||
      !Number.isFinite(section_index_end) ||
      typeof cleaning_method !== "string" ||
      typeof cleaned_at !== "string"
    ) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    await runAsync(
      `UPDATE cleaning_events
       SET cable_id = ?, section_index_start = ?, section_index_end = ?, cleaning_method = ?, cleaned_at = ?, cleaning_count = ?
       WHERE id = ?`,
      [cable_id, section_index_start, section_index_end, cleaning_method, cleaned_at, Number.isFinite(cleaning_count) ? cleaning_count : 1, id]
    );
    const updated = await getAsync("SELECT * FROM cleaning_events WHERE id = ?", [id]);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update event" });
  }
});

app.delete("/api/events/:id", async (req, res) => {
  try {
    const id = requireValidId(req, res);
    if (id === null) return;
    await runAsync("DELETE FROM cleaning_events WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete event" });
  }
});

app.delete("/api/events", async (_req, res) => {
  try {
    await runAsync("DELETE FROM cleaning_events", []);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to clear all events" });
  }
});

// aggregate stats
app.get("/api/stats", async (_req, res) => {
  try {
    const totalEvents = await getAsync("SELECT COUNT(*) as count FROM cleaning_events");
    const totals = await getAsync("SELECT SUM(section_index_end - section_index_start + 1) as totalSections FROM cleaning_events");
    const cfg = await loadConfig();
    const sectionLength = cfg.sectionLength || 1;
    const totalSections = totals?.totalSections || 0;
    const totalDistance = totalSections * sectionLength;

    const N = cfg.sectionsPerCable;
    const tailSections = cfg.useRopeForTail ? 0 : 5;
    const totalAvailableSections = cfg.numCables * N;
    const totalAvailableTail = cfg.numCables * tailSections;

    // Calculate unique sections cleaned with active/tail breakdown
    const allEvents = await allAsync("SELECT cable_id, section_index_start, section_index_end FROM cleaning_events");
    const uniqueSections = new Set();
    const uniqueActiveSections = new Set();
    const uniqueTailSections = new Set();

    for (const evt of allEvents) {
      for (let s = evt.section_index_start; s <= evt.section_index_end; s++) {
        uniqueSections.add(`${evt.cable_id}-${s}`);
        if (s < N) {
          uniqueActiveSections.add(`${evt.cable_id}-${s}`);
        } else {
          uniqueTailSections.add(`${evt.cable_id}-${s}`);
        }
      }
    }

    const uniqueCleanedSections = uniqueSections.size;
    const activeCleanedSections = uniqueActiveSections.size;
    const tailCleanedSections = uniqueTailSections.size;

    res.json({
      totalEvents: totalEvents.count,
      totalSections,
      totalDistance,
      uniqueCleanedSections,
      activeCleanedSections,
      tailCleanedSections,
      totalAvailableSections,
      totalAvailableTail
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get stats" });
  }
});

/**
 * last-cleaned map for heat-map
 * NOW includes tail sections when cfg.useRopeForTail === false (adds 5 tail sections)
 * For each cable: Array(totalLen) where totalLen = N + tailSections.
 * Fill with latest cleaned_at per section index (active + tails).
 */
app.get("/api/last-cleaned", async (_req, res) => {
  try {
    const cfg = await loadConfig();
    const N = cfg.sectionsPerCable;
    const cableCount = cfg.numCables;
    const tailSections = cfg.useRopeForTail ? 0 : 5;
    const totalSections = N + tailSections;

    const rows = await allAsync(
      `SELECT cable_id, section_index_start, section_index_end, cleaned_at
       FROM cleaning_events
       ORDER BY datetime(cleaned_at) DESC`
    );

    const map = {};
    for (let c = 0; c < cableCount; c++) {
      map[`cable-${c}`] = Array(totalSections).fill(null);
    }

    for (const r of rows) {
      const arr = map[r.cable_id];
      if (!arr) continue;
      for (let s = r.section_index_start; s <= r.section_index_end && s < totalSections; s++) {
        if (!arr[s]) arr[s] = r.cleaned_at;   // keep latest per section
      }
    }

    res.json({ lastCleaned: map });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to compute last-cleaned" });
  }
});

// filtered last-cleaned map - for PDF generation only
app.get('/api/last-cleaned-filtered', async (req, res) => {
  try {
    const { start, end } = req.query;
    const cfg = await loadConfig();
    const N = cfg.sectionsPerCable;
    const cableCount = cfg.numCables;
    const tailSections = cfg.useRopeForTail ? 0 : 5;
    const totalSections = N + tailSections;

    // Build query with date filter
    let sql = `
      SELECT cable_id, section_index_start, section_index_end, cleaned_at 
      FROM cleaning_events
    `;
    const params = [];
    
    if (start && end) {
      sql += ' WHERE DATE(cleaned_at) BETWEEN DATE(?) AND DATE(?)';
      params.push(start, end);
    } else if (start) {
      sql += ' WHERE DATE(cleaned_at) >= DATE(?)';
      params.push(start);
    } else if (end) {
      sql += ' WHERE DATE(cleaned_at) <= DATE(?)';
      params.push(end);
    }
    
    sql += ' ORDER BY datetime(cleaned_at) DESC';

    const rows = await allAsync(sql, params);

    // Initialize map with nulls
    const map = {};
    for (let c = 0; c < cableCount; c++) {
      map[`cable-${c}`] = Array(totalSections).fill(null);
    }

    // Fill with last cleaned date per section (within filter period only)
    for (const r of rows) {
      const arr = map[r.cable_id];
      if (!arr) continue;
      for (let s = r.section_index_start; s <= r.section_index_end && s < totalSections; s++) {
        if (!arr[s]) {
          arr[s] = r.cleaned_at; // keep latest per section in filtered period
        }
      }
    }

    res.json({ lastCleaned: map });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to compute filtered last-cleaned' });
  }
});


// filtered stats
app.get("/api/stats/filter", async (req, res) => {
  try {
    const { start, end } = req.query;
    const cfg = await loadConfig();
    const sectionLength = cfg.sectionLength || 1;
    const N = cfg.sectionsPerCable;
    const tailSections = cfg.useRopeForTail ? 0 : 5;

    let sql = "SELECT * FROM cleaning_events";
    const params = [];
    if (start && end) {
      sql += " WHERE DATE(cleaned_at) BETWEEN DATE(?) AND DATE(?)";
      params.push(start, end);
    } else if (start) {
      sql += " WHERE DATE(cleaned_at) >= DATE(?)";
      params.push(start);
    } else if (end) {
      sql += " WHERE DATE(cleaned_at) <= DATE(?)";
      params.push(end);
    }

    sql += " ORDER BY datetime(cleaned_at) DESC";
    const rows = await allAsync(sql, params);

    const totalSectionsCleaned = rows.reduce((acc, r) => acc + (r.section_index_end - r.section_index_start + 1), 0);
    const totalDistance = totalSectionsCleaned * sectionLength;
    const lastCleaning = rows[0]?.cleaned_at || null;

    // Calculate unique sections in filtered period with active/tail breakdown
    const uniqueSections = new Set();
    const uniqueActiveSections = new Set();
    const uniqueTailSections = new Set();

    const byMethod = {};
    for (const r of rows) {
      const len = (r.section_index_end - r.section_index_start + 1) * sectionLength;
      byMethod[r.cleaning_method] = (byMethod[r.cleaning_method] || 0) + len;

      for (let s = r.section_index_start; s <= r.section_index_end; s++) {
        uniqueSections.add(`${r.cable_id}-${s}`);
        if (s < N) {
          uniqueActiveSections.add(`${r.cable_id}-${s}`);
        } else {
          uniqueTailSections.add(`${r.cable_id}-${s}`);
        }
      }
    }

    res.json({
      events: rows.length,
      totalDistance,
      lastCleaning,
      byMethod,
      uniqueCleanedSections: uniqueSections.size,
      activeCleanedSections: uniqueActiveSections.size,
      tailCleanedSections: uniqueTailSections.size
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get filtered stats" });
  }
});

// fallback
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


