// Shared supertest harness: real Express app on a scratch SQLite database (see jest.setup.js).
const request = require("supertest");
const { app } = require("../../server");
const { initDb, runAsync } = require("../../db");
const { ensureUsersSeeded, reseedUsers } = require("../../userStore");

let readyPromise = null;

/** Resolves once schema.sql and migrations have been applied to the scratch database. */
function ready() {
  if (!readyPromise) {
    readyPromise = new Promise((resolve) => initDb(resolve));
  }
  return readyPromise;
}

/** Empties every table so each test starts from a known state. */
async function resetDb() {
  await ready();
  for (const table of ["noise_data", "noise_uploads", "cleaning_events", "eb_cleaning_events", "streamer_deployments", "vessel_context", "projects", "app_config"]) {
    await runAsync(`DELETE FROM ${table}`);
  }
  // Back to the known AUTH_USERS set from jest.setup.js. Wait for the server's own
  // startup seed first, or it could keep inserting after the delete below.
  await ensureUsersSeeded();
  await runAsync("DELETE FROM users");
  await reseedUsers();
}

/** Logs in a user from the test AUTH_USERS set and returns a Bearer header value. */
async function login(username) {
  const res = await request(app)
    .post("/api/login")
    .send({ username, password: process.env.TEST_PASSWORD });
  if (res.status !== 200) {
    throw new Error(`login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return `Bearer ${res.body.token}`;
}

/** Inserts a project row directly and returns it (camelCase keys like the API). */
async function createProject({ projectNumber, vesselTag = "TTN", numCables = 12, sectionsPerCable = 107, useRopeForTail = 1, ebFront = 0 }) {
  const result = await runAsync(
    `INSERT INTO projects (project_number, vessel_tag, num_cables, sections_per_cable, use_rope_for_tail, eb_front)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [projectNumber, vesselTag, numCables, sectionsPerCable, useRopeForTail, ebFront ? 1 : 0]
  );
  return { id: result.lastID, projectNumber, vesselTag, numCables, sectionsPerCable };
}

/** Marks a project active for its vessel (vessel_context upsert). */
async function activateProject(project) {
  await runAsync(
    `INSERT INTO vessel_context (vessel_tag, active_project_id, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(vessel_tag) DO UPDATE SET active_project_id = excluded.active_project_id`,
    [project.vesselTag, project.id, new Date().toISOString()]
  );
}

module.exports = { app, request, ready, resetDb, login, createProject, activateProject };
