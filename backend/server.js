
// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const { initDb, createBackup } = require("./db");
const { startBackupScheduler } = require("./backupScheduler");
const { createSessionStore } = require("./sessionStore");
const {
  createAuthMiddleware,
  superUserOnly,
  adminOrAbove,
} = require("./middleware/auth");
const { createAuthRouter } = require("./routes/auth");
const { createBackupsRouter } = require("./routes/backups");
const { createConfigRouter } = require("./routes/config");
const { createProjectsRouter } = require("./routes/projects");
const { createEventsRouter } = require("./routes/events");
const { createStatsRouter } = require("./routes/stats");
const { createNoiseRouter } = require("./routes/noise");
const { createUsersRouter } = require("./routes/users");
const { ensureUsersSeeded } = require("./userStore");

const app = express();
const PORT = process.env.PORT || 3000;
initDb(async () => {
  // First start with an empty users table: copy the accounts from AUTH_USERS.
  try {
    await ensureUsersSeeded();
  } catch (err) {
    console.error("[auth] Could not prepare user accounts:", err);
  }
  // Only now take the startup backup: it checkpoints the database, which is refused
  // while migrations or the user import are still writing.
  if (process.env.NODE_ENV !== "test") {
    startBackupScheduler(createBackup);
  }
});

const sessionStore = createSessionStore();
const authMiddleware = createAuthMiddleware(sessionStore);

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
if (process.env.PORT === "3001" && !allowed.includes("http://localhost:3001")) {
  allowed.push("http://localhost:3001");
}

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowed.includes(origin)) cb(null, true);
      else cb(new Error("Not allowed by CORS"));
    },
  })
);

// Bulk CSV import sends JSON much larger than the raw file (default limit is 100kb).
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "10mb" }));
// serve frontend
app.use(express.static(path.join(__dirname, "..", "public")));

// dedicated config page
app.get("/config", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "config.html"));
});

// dedicated stats page
app.get("/stats", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "stats.html"));
});

// dedicated planning page
app.get("/planning", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "planning.html"));
});

// dedicated help page
app.get("/help", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "help.html"));
});

// Mount route modules
const authRouter = createAuthRouter(sessionStore, authMiddleware);
const backupsRouter = createBackupsRouter(authMiddleware, superUserOnly, sessionStore);
const configRouter = createConfigRouter(authMiddleware, superUserOnly);
const projectsRouter = createProjectsRouter(authMiddleware, superUserOnly);
const eventsRouter = createEventsRouter(authMiddleware, adminOrAbove, superUserOnly);
const statsRouter = createStatsRouter(authMiddleware);
const noiseRouter = createNoiseRouter(authMiddleware, adminOrAbove);
const usersRouter = createUsersRouter(authMiddleware, superUserOnly, sessionStore);

app.use("/", authRouter);
app.use("/", backupsRouter);
app.use("/", configRouter);
app.use("/", projectsRouter);
app.use("/", eventsRouter);
app.use("/", statsRouter);
app.use("/", noiseRouter);
app.use("/", usersRouter);

// fallback
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// Only start server when run directly (not when required for tests)
if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = { app };

