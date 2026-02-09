// config.js
const humps = require("humps");
const { runAsync, allAsync } = require("./db");

const defaultConfig = {
  numCables: 12,
  sectionsPerCable: 107,
  sectionLength: 75,
  moduleFrequency: 4,
  useRopeForTail: true,
  channelsPerSection: 6,
  activeProjectNumber: null,
  vesselTag: "TTN",
};

/**
 * Load app config from database and merge with defaults (camelCase keys).
 * @returns {Promise<Object>}
 */
async function loadConfig() {
  const rows = await allAsync("SELECT key, value FROM app_config");
  const config = humps.camelizeKeys(Object.assign({}, defaultConfig));
  for (const row of rows) {
    const v = row.value;
    const camelKey = humps.camelize(row.key);
    config[camelKey] =
      v === "true" ? true
      : v === "false" ? false
      : Number.isFinite(Number(v)) ? Number(v)
      : v;
  }
  return config;
}

/**
 * Save partial config to database (keys stored as snake_case).
 * @param {Object} [partial={}] - Config keys and values to save
 */
async function saveConfig(partial = {}) {
  const keys = Object.keys(partial);
  for (const key of keys) {
    const value = String(partial[key]);
    const snakeKey = humps.decamelize(key);
    await runAsync(
      "INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [snakeKey, value]
    );
  }
}

module.exports = { defaultConfig, loadConfig, saveConfig };
