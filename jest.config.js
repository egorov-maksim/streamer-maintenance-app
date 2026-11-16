/** @type {import("jest").Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/backend/tests/**/*.test.js", "<rootDir>/public/tests/**/*.test.js"],
  // Runs before each test file: points db.js at a per-worker scratch database and
  // provides a known AUTH_USERS set, so tests never touch backend/streamer.db or backup/.
  setupFiles: ["<rootDir>/backend/tests/jest.setup.js"],
  testTimeout: 15000,
};
