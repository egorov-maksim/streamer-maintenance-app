
// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const { initDb } = require("./db");
const {
  loadUsersFromEnv,
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

const app = express();
const PORT = process.env.PORT || 3000;
initDb();

const users = loadUsersFromEnv();
const sessions = new Map();
const authMiddleware = createAuthMiddleware(sessions);

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

app.use(express.json());
// serve frontend
app.use(express.static(path.join(__dirname, "..", "public")));

// Mount route modules
const authRouter = createAuthRouter(sessions, users, authMiddleware);
const backupsRouter = createBackupsRouter(authMiddleware, superUserOnly);
const configRouter = createConfigRouter(authMiddleware, superUserOnly);
const projectsRouter = createProjectsRouter(authMiddleware, superUserOnly);
const eventsRouter = createEventsRouter(authMiddleware, adminOrAbove);
const statsRouter = createStatsRouter();

app.use("/", authRouter);
app.use("/", backupsRouter);
app.use("/", configRouter);
app.use("/", projectsRouter);
app.use("/", eventsRouter);
app.use("/", statsRouter);

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

