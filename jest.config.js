/** @type {import("jest").Config} */
module.exports = {
  testEnvironment: "node",
  // Backend tests are CommonJS; browser-module tests are .mjs so they import the ESM
  // files under public/ (kept outside public/ so express.static never serves them).
  testMatch: ["<rootDir>/backend/tests/**/*.test.js", "<rootDir>/tests/**/*.test.mjs"],
  moduleFileExtensions: ["js", "mjs", "json"],
  // Runs before each test file: points db.js at a per-worker scratch database and
  // provides a known AUTH_USERS set, so tests never touch backend/streamer.db or backup/.
  setupFiles: ["<rootDir>/backend/tests/jest.setup.js"],
  testTimeout: 15000,
};
