// tests/helpers.js
// Shared test helpers and utilities
// Note: Project and config creation/updates require SuperUser; use loginAs("superuser", "super123") for those operations.

const request = require("supertest");

// Set environment variables before requiring the server
process.env.DB_FILE = "./backend/test.db";
process.env.AUTH_USERS = "superuser:super123:superuser,admin:admin123:admin,viewer:view123:viewer";

// Import app after setting env
const { app } = require("../backend/server");

// Login helper to get auth token
async function loginAs(username, password) {
  const res = await request(app)
    .post("/api/login")
    .send({ username, password });
  
  if (res.status !== 200) {
    throw new Error(`Login failed for ${username}: ${res.status}`);
  }
  
  return res.body.token;
}

// Get auth header for requests
function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

module.exports = {
  app,
  loginAs,
  authHeader
};
