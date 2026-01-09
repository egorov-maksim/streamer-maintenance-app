
// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const crypto = require("crypto");
const { db, initDb } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
initDb();

// ---- Authentication ----
// Load user credentials from environment variable
// Format: USERNAME:PASSWORD:ROLE,USERNAME:PASSWORD:ROLE
function loadUsersFromEnv() {
  const authUsersEnv = process.env.AUTH_USERS;
  const users = {};
  
  authUsersEnv.split(",").forEach(userStr => {
    const parts = userStr.trim().split(":");
    if (parts.length >= 3) {
      const username = parts[0].trim();
      const password = parts[1].trim();
      const role = parts[2].trim();
      users[username] = { password, role };
    }
  });
  
  return users;
}

const users = loadUsersFromEnv();

// Simple session store (in production, use Redis or database-backed sessions)
const sessions = new Map();

// Generate session token
function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

// Auth middleware - checks Bearer token
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  const token = authHeader.slice(7);
  const session = sessions.get(token);
  
  if (!session) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
  
  req.user = session;
  next();
}

// Admin-only middleware
function adminOnly(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

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
  sectionLength: 75,
  moduleFrequency: 4,
  useRopeForTail: true,     // true = rope (no tails), false = add 5 tails
  channelsPerSection: 6,
  activeProjectNumber: null,
  vesselTag: 'TTN',
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

// Helper: Calculate EB range for a section range
// Logic: Find closest module AT OR BEFORE startSection and AT OR AFTER endSection
function calculateEBRange(startSection, endSection, config) {
  const moduleFreq = config.moduleFrequency || 4;
  const N = config.sectionsPerCable;
  
  // Build complete list of all module positions
  // Module positions: EB01 at section 0, then every moduleFreq sections
  // EB01 = after AS01 (section 0)
  // EB02 = after AS05 (section 4) if moduleFreq=4
  // etc.
  const allModules = [];
  
  // First module after AS01 (section index 0)
  allModules.push({ num: 1, section: 0 });
  
  // Regular modules every moduleFreq sections
  for (let s = moduleFreq; s < N; s += moduleFreq) {
    const moduleNum = Math.floor(s / moduleFreq) + 1;
    allModules.push({ num: moduleNum, section: s });
  }
  
  // Last module is after the last active section (N-1)
  // Calculate what module number that would be
  const lastModuleNum = Math.floor((N - 1) / moduleFreq) + 1;
  // Only add if not already present
  if (!allModules.some(m => m.num === lastModuleNum)) {
    allModules.push({ num: lastModuleNum, section: N - 1 });
  }
  
  // Find closest module AT OR BEFORE startSection
  const before = allModules
    .filter(m => m.section <= startSection)
    .sort((a, b) => b.section - a.section)[0];
  
  // Find closest module AT OR AFTER endSection
  const after = allModules
    .filter(m => m.section >= endSection)
    .sort((a, b) => a.section - b.section)[0];
  
  const formatEB = (num) => `EB${String(num).padStart(2, '0')}`;
  
  if (before && after) {
    if (before.num === after.num) return formatEB(before.num);
    // Higher module number first (closer to tail), then lower (closer to head)
    return `${formatEB(Math.max(before.num, after.num))} - ${formatEB(Math.min(before.num, after.num))}`;
  } else if (before) {
    // Sections are past the last module, heading into tail
    return `Tail Adaptor - ${formatEB(before.num)}`;
  } else if (after) {
    // Edge case: sections before first module
    return formatEB(after.num);
  }
  
  return '-';
}

// ---- Backup Management Endpoints ----

// List available backups
app.get("/api/backups", authMiddleware, adminOnly, async (_req, res) => {
  try {
    const fs = require("fs");
    const backupDir = path.join(__dirname, "..", "backup");
    
    if (!fs.existsSync(backupDir)) {
      return res.json({ backups: [] });
    }
    
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith("streamer_backup_") && f.endsWith(".db"))
      .map(f => {
        const filePath = path.join(backupDir, f);
        const stats = fs.statSync(filePath);
        return {
          filename: f,
          size: stats.size,
          created_at: stats.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    res.json({ backups: files });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list backups" });
  }
});

// Create a manual backup
app.post("/api/backups", authMiddleware, adminOnly, async (_req, res) => {
  try {
    const { createBackup } = require("./db");
    const backupPath = await createBackup();
    res.json({ success: true, path: backupPath });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create backup" });
  }
});

// Restore from backup
app.post("/api/backups/:filename/restore", authMiddleware, adminOnly, async (req, res) => {
  try {
    const fs = require("fs");
    const { filename } = req.params;
    const backupDir = path.join(__dirname, "..", "backup");
    const backupPath = path.join(backupDir, filename);
    
    // Validate filename to prevent directory traversal
    if (!filename.startsWith("streamer_backup_") || !filename.endsWith(".db") || filename.includes("..")) {
      return res.status(400).json({ error: "Invalid backup filename" });
    }
    
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: "Backup file not found" });
    }
    
    // First create a backup of the current state before restoring
    const { createBackup } = require("./db");
    await createBackup();
    
    // Close database and restore
    const dbPath = path.join(__dirname, "streamer.db");
    
    // Copy backup to database file
    fs.copyFileSync(backupPath, dbPath);
    
    res.json({ 
      success: true, 
      message: "Database restored successfully. Please restart the server for changes to take effect.",
      restoredFrom: filename
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to restore backup" });
  }
});

// Get project event counts
app.get("/api/projects/stats", async (_req, res) => {
  try {
    const rows = await allAsync(`
      SELECT project_number, COUNT(*) as event_count 
      FROM cleaning_events 
      WHERE project_number IS NOT NULL 
      GROUP BY project_number
    `);
    
    const stats = {};
    for (const row of rows) {
      stats[row.project_number] = row.event_count;
    }
    
    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get project stats" });
  }
});

// ---- endpoints ----

// Authentication endpoints
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  
  const user = users[username];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  
  const token = generateSessionToken();
  sessions.set(token, { username, role: user.role });
  
  res.json({ 
    token, 
    username, 
    role: user.role,
    message: "Login successful" 
  });
});

app.post("/api/logout", (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    sessions.delete(token);
  }
  res.json({ success: true, message: "Logged out successfully" });
});

app.get("/api/session", authMiddleware, (req, res) => {
  res.json({ 
    username: req.user.username, 
    role: req.user.role 
  });
});

// EB Range calculation API
app.get("/api/eb-range", async (req, res) => {
  try {
    const startSection = toInt(req.query.start, NaN);
    const endSection = toInt(req.query.end, NaN);
    
    if (Number.isNaN(startSection) || Number.isNaN(endSection)) {
      return res.status(400).json({ error: "start and end query params required" });
    }
    
    const cfg = await loadConfig();
    const ebRange = calculateEBRange(startSection, endSection, cfg);
    
    res.json({ ebRange });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to calculate EB range" });
  }
});

app.get("/api/config", async (_req, res) => {
  try {
    const cfg = await loadConfig();
    res.json(cfg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load config" });
  }
});

app.put("/api/config", authMiddleware, adminOnly, async (req, res) => {
  try {
    const partial = {
      numCables: toInt(req.body?.numCables, defaultConfig.numCables),
      sectionsPerCable: toInt(req.body?.sectionsPerCable, defaultConfig.sectionsPerCable),
      sectionLength: toInt(req.body?.sectionLength, defaultConfig.sectionLength),
      moduleFrequency: toInt(req.body?.moduleFrequency, defaultConfig.moduleFrequency),
      useRopeForTail: Boolean(req.body?.useRopeForTail),
      channelsPerSection: toInt(req.body?.channelsPerSection, defaultConfig.channelsPerSection),
      vesselTag: req.body?.vesselTag || defaultConfig.vesselTag,
    };
    // Handle activeProjectNumber separately (can be null)
    if (req.body?.activeProjectNumber !== undefined) {
      partial.activeProjectNumber = req.body.activeProjectNumber || null;
    }
    await saveConfig(partial);
    const cfg = await loadConfig();
    res.json(cfg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save config" });
  }
});

// ---- Project Management Endpoints ----

// Helper to format project response with proper boolean conversion
function formatProjectResponse(project) {
  if (!project) return null;
  return {
    ...project,
    use_rope_for_tail: project.use_rope_for_tail === 1,
    is_active: project.is_active === 1
  };
}

// Get all projects
app.get("/api/projects", async (_req, res) => {
  try {
    const rows = await allAsync("SELECT * FROM projects ORDER BY created_at DESC");
    res.json(rows.map(formatProjectResponse));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// Get active project with full config
app.get("/api/projects/active", async (_req, res) => {
  try {
    const project = await getAsync("SELECT * FROM projects WHERE is_active = 1");
    res.json(formatProjectResponse(project));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch active project" });
  }
});

// Create new project with streamer configuration
app.post("/api/projects", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { 
      project_number, 
      project_name, 
      vessel_tag,
      num_cables,
      sections_per_cable,
      section_length,
      module_frequency,
      channels_per_section,
      use_rope_for_tail
    } = req.body;
    
    if (!project_number || typeof project_number !== "string") {
      return res.status(400).json({ error: "Project number is required" });
    }
    
    const created_at = new Date().toISOString();
    const result = await runAsync(
      `INSERT INTO projects (
        project_number, project_name, vessel_tag, created_at, is_active,
        num_cables, sections_per_cable, section_length, module_frequency, channels_per_section, use_rope_for_tail
      ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      [
        project_number, 
        project_name || null, 
        vessel_tag || 'TTN', 
        created_at,
        toInt(num_cables, 12),
        toInt(sections_per_cable, 107),
        toInt(section_length, 75),
        toInt(module_frequency, 4),
        toInt(channels_per_section, 6),
        use_rope_for_tail === false ? 0 : 1
      ]
    );
    
    const created = await getAsync("SELECT * FROM projects WHERE id = ?", [result.lastID]);
    res.json(formatProjectResponse(created));
  } catch (err) {
    console.error(err);
    if (err.message?.includes("UNIQUE constraint failed")) {
      res.status(400).json({ error: "Project number already exists" });
    } else {
      res.status(500).json({ error: "Failed to create project" });
    }
  }
});

// Set active project - also syncs global config with project's streamer config
app.put("/api/projects/:id/activate", authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = requireValidId(req, res);
    if (id === null) return;
    
    // Deactivate all projects first
    await runAsync("UPDATE projects SET is_active = 0");
    // Activate the selected project
    await runAsync("UPDATE projects SET is_active = 1 WHERE id = ?", [id]);
    
    const project = await getAsync("SELECT * FROM projects WHERE id = ?", [id]);
    
    // Update global config with active project's settings
    if (project) {
      await saveConfig({ 
        activeProjectNumber: project.project_number,
        vesselTag: project.vessel_tag || 'TTN',
        numCables: project.num_cables || 12,
        sectionsPerCable: project.sections_per_cable || 107,
        sectionLength: project.section_length || 75,
        moduleFrequency: project.module_frequency || 4,
        channelsPerSection: project.channels_per_section || 6,
        useRopeForTail: project.use_rope_for_tail === 1
      });
    }
    
    res.json(formatProjectResponse(project));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to activate project" });
  }
});

// Update project configuration
app.put("/api/projects/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = requireValidId(req, res);
    if (id === null) return;
    
    const { 
      project_name, 
      vessel_tag,
      num_cables,
      sections_per_cable,
      section_length,
      module_frequency,
      channels_per_section,
      use_rope_for_tail
    } = req.body;
    
    await runAsync(
      `UPDATE projects SET 
        project_name = ?,
        vessel_tag = ?,
        num_cables = ?,
        sections_per_cable = ?,
        section_length = ?,
        module_frequency = ?,
        channels_per_section = ?,
        use_rope_for_tail = ?
      WHERE id = ?`,
      [
        project_name || null,
        vessel_tag || 'TTN',
        toInt(num_cables, 12),
        toInt(sections_per_cable, 107),
        toInt(section_length, 75),
        toInt(module_frequency, 4),
        toInt(channels_per_section, 6),
        use_rope_for_tail === false ? 0 : 1,
        id
      ]
    );
    
    const updated = await getAsync("SELECT * FROM projects WHERE id = ?", [id]);
    
    // If this is the active project, also update global config
    if (updated && updated.is_active === 1) {
      await saveConfig({ 
        vesselTag: updated.vessel_tag || 'TTN',
        numCables: updated.num_cables || 12,
        sectionsPerCable: updated.sections_per_cable || 107,
        sectionLength: updated.section_length || 75,
        moduleFrequency: updated.module_frequency || 4,
        channelsPerSection: updated.channels_per_section || 6,
        useRopeForTail: updated.use_rope_for_tail === 1
      });
    }
    
    res.json(formatProjectResponse(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update project" });
  }
});

// Deactivate all projects (clear active project)
app.post("/api/projects/deactivate", authMiddleware, adminOnly, async (_req, res) => {
  try {
    await runAsync("UPDATE projects SET is_active = 0");
    await saveConfig({ activeProjectNumber: null });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to deactivate projects" });
  }
});

// Delete project (only if no events associated)
app.delete("/api/projects/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = requireValidId(req, res);
    if (id === null) return;
    
    const project = await getAsync("SELECT * FROM projects WHERE id = ?", [id]);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    
    // Check if any events are associated with this project
    const eventCount = await getAsync(
      "SELECT COUNT(*) as count FROM cleaning_events WHERE project_number = ?",
      [project.project_number]
    );
    
    if (eventCount.count > 0) {
      return res.status(400).json({ 
        error: `Cannot delete project with ${eventCount.count} associated events. Archive or reassign events first.` 
      });
    }
    
    await runAsync("DELETE FROM projects WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete project" });
  }
});

app.get("/api/events", async (req, res) => {
  try {
    const { project } = req.query;
    let sql = "SELECT * FROM cleaning_events";
    const params = [];
    
    if (project) {
      sql += " WHERE project_number = ?";
      params.push(project);
    }
    
    sql += " ORDER BY datetime(cleaned_at) DESC";
    const rows = await allAsync(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

app.post("/api/events", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { cable_id, section_index_start, section_index_end, cleaning_method, cleaned_at, cleaning_count, project_number, vessel_tag } = req.body;
    if (
      typeof cable_id !== "string" ||
      !Number.isFinite(section_index_start) ||
      !Number.isFinite(section_index_end) ||
      typeof cleaning_method !== "string" ||
      typeof cleaned_at !== "string"
    ) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    
    // Get active project if not specified
    let finalProjectNumber = project_number;
    let finalVesselTag = vessel_tag || 'TTN';
    
    if (!finalProjectNumber) {
      const cfg = await loadConfig();
      finalProjectNumber = cfg.activeProjectNumber || null;
      finalVesselTag = cfg.vesselTag || 'TTN';
    }
    
    const result = await runAsync(
      `INSERT INTO cleaning_events (cable_id, section_index_start, section_index_end, cleaning_method, cleaned_at, cleaning_count, project_number, vessel_tag)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [cable_id, section_index_start, section_index_end, cleaning_method, cleaned_at, Number.isFinite(cleaning_count) ? cleaning_count : 1, finalProjectNumber, finalVesselTag]
    );
    const created = await getAsync("SELECT * FROM cleaning_events WHERE id = ?", [result.lastID]);
    res.json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create event" });
  }
});

app.put("/api/events/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = requireValidId(req, res);
    if (id === null) return;

    const { cable_id, section_index_start, section_index_end, cleaning_method, cleaned_at, cleaning_count, project_number, vessel_tag } = req.body;
    if (
      typeof cable_id !== "string" ||
      !Number.isFinite(section_index_start) ||
      !Number.isFinite(section_index_end) ||
      typeof cleaning_method !== "string" ||
      typeof cleaned_at !== "string"
    ) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const existing = await getAsync("SELECT * FROM cleaning_events WHERE id = ?", [id]);
    const finalProjectNumber = project_number !== undefined ? project_number : (existing?.project_number || null);
    const finalVesselTag = vessel_tag !== undefined ? vessel_tag : (existing?.vessel_tag || 'TTN');

    await runAsync(
      `UPDATE cleaning_events
       SET cable_id = ?, section_index_start = ?, section_index_end = ?, cleaning_method = ?, cleaned_at = ?, cleaning_count = ?, project_number = ?, vessel_tag = ?
       WHERE id = ?`,
      [cable_id, section_index_start, section_index_end, cleaning_method, cleaned_at, Number.isFinite(cleaning_count) ? cleaning_count : 1, finalProjectNumber, finalVesselTag, id]
    );
    const updated = await getAsync("SELECT * FROM cleaning_events WHERE id = ?", [id]);
      res.json(updated);
    } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update event" });
  }
});

app.delete("/api/events/:id", authMiddleware, adminOnly, async (req, res) => {
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

app.delete("/api/events", authMiddleware, adminOnly, async (_req, res) => {
  try {
    await runAsync("DELETE FROM cleaning_events", []);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to clear all events" });
  }
});

// aggregate stats
app.get("/api/stats", async (req, res) => {
  try {
    const { project } = req.query;
    const cfg = await loadConfig();
    const sectionLength = cfg.sectionLength || 1;
    const N = cfg.sectionsPerCable;
    const tailSections = cfg.useRopeForTail ? 0 : 5;
    const totalAvailableSections = cfg.numCables * N;
    const totalAvailableTail = cfg.numCables * tailSections;
    
    let whereClause = "";
    const params = [];
    if (project) {
      whereClause = " WHERE project_number = ?";
      params.push(project);
    }
    
    const totalEvents = await getAsync(`SELECT COUNT(*) as count FROM cleaning_events${whereClause}`, params);
    const totals = await getAsync(`SELECT SUM(section_index_end - section_index_start + 1) as totalSections FROM cleaning_events${whereClause}`, params);
    
    const totalSectionsCleaned = totals?.totalSections || 0;
    const totalDistance = totalSectionsCleaned * sectionLength;

    // Calculate unique sections cleaned with active/tail breakdown
    const allEvents = await allAsync(`SELECT cable_id, section_index_start, section_index_end FROM cleaning_events${whereClause}`, params);
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
      totalSections: totalSectionsCleaned,
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
 * Optionally filter by project_number
 */
app.get("/api/last-cleaned", async (req, res) => {
  try {
    const { project } = req.query;
    const cfg = await loadConfig();
    const N = cfg.sectionsPerCable;
    const cableCount = cfg.numCables;
    const tailSections = cfg.useRopeForTail ? 0 : 5;
    const totalSections = N + tailSections;

    let sql = `SELECT cable_id, section_index_start, section_index_end, cleaned_at
       FROM cleaning_events`;
    const params = [];
    
    if (project) {
      sql += " WHERE project_number = ?";
      params.push(project);
    }
    
    sql += " ORDER BY datetime(cleaned_at) DESC";
    const rows = await allAsync(sql, params);

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
    const { start, end, project } = req.query;
    const cfg = await loadConfig();
    const N = cfg.sectionsPerCable;
    const cableCount = cfg.numCables;
    const tailSections = cfg.useRopeForTail ? 0 : 5;
    const totalSections = N + tailSections;

    // Build query with date and project filters
    let sql = `
      SELECT cable_id, section_index_start, section_index_end, cleaned_at 
      FROM cleaning_events
    `;
    const params = [];
    const conditions = [];
    
    if (project) {
      conditions.push('project_number = ?');
      params.push(project);
    }
    
    if (start && end) {
      conditions.push('DATE(cleaned_at) BETWEEN DATE(?) AND DATE(?)');
      params.push(start, end);
    } else if (start) {
      conditions.push('DATE(cleaned_at) >= DATE(?)');
      params.push(start);
    } else if (end) {
      conditions.push('DATE(cleaned_at) <= DATE(?)');
      params.push(end);
    }
    
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
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
    const { start, end, project } = req.query;
    const cfg = await loadConfig();
    const sectionLength = cfg.sectionLength || 1;
    const N = cfg.sectionsPerCable;
    const tailSections = cfg.useRopeForTail ? 0 : 5;

    let sql = "SELECT * FROM cleaning_events";
    const params = [];
    const conditions = [];
    
    if (project) {
      conditions.push("project_number = ?");
      params.push(project);
    }
    
    if (start && end) {
      conditions.push("DATE(cleaned_at) BETWEEN DATE(?) AND DATE(?)");
      params.push(start, end);
    } else if (start) {
      conditions.push("DATE(cleaned_at) >= DATE(?)");
      params.push(start);
    } else if (end) {
      conditions.push("DATE(cleaned_at) <= DATE(?)");
      params.push(end);
    }
    
    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
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



