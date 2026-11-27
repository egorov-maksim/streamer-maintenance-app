// config.js
const humps = require("humps");
const { runAsync, allAsync } = require("./db");

const defaultConfig = {
  numCables: 12,
  sectionsPerCable: 107,
  sectionLength: 75,
  moduleFrequency: 4,
  useRopeForTail: true,
  ebFront: false,
  channelsPerSection: 6,
  activeProjectNumber: null,
  vesselTag: "TTN",
};

// app_config stores every value as TEXT; these sets say how to read each known key back.
const NUMERIC_KEYS = new Set([
  "numCables", "sectionsPerCable", "sectionLength", "moduleFrequency",
  "channelsPerSection", "suggestedCleaningThresholdDays",
]);
const BOOLEAN_KEYS = new Set(["useRopeForTail", "ebFront"]);
// Identifiers stay strings even when they look numeric ("007" is a vessel tag, not 7).
const STRING_KEYS = new Set(["vesselTag", "activeProjectNumber"]);

/**
 * Converts a stored TEXT value back to the type the key expects.
 * Older versions persisted null as the literal "null"; that is read back as null.
 * @param {string} camelKey
 * @param {string} raw
 */
function parseStoredValue(camelKey, raw) {
  if (raw === null || raw === undefined || raw === "null") return null;
  if (BOOLEAN_KEYS.has(camelKey)) return raw === "true";
  if (NUMERIC_KEYS.has(camelKey)) {
    const n = Number(raw);
    return raw.trim() !== "" && Number.isFinite(n) ? n : defaultConfig[camelKey] ?? null;
  }
  if (STRING_KEYS.has(camelKey)) return raw === "" ? null : raw;
  // Unknown key: keep the historical best-effort coercion.
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw.trim() !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
}

/**
 * Load app config from database and merge with defaults (camelCase keys).
 * @returns {Promise<Object>}
 */
async function loadConfig() {
  const rows = await allAsync("SELECT key, value FROM app_config");
  const config = humps.camelizeKeys(Object.assign({}, defaultConfig));
  for (const row of rows) {
    const camelKey = humps.camelize(row.key);
    config[camelKey] = parseStoredValue(camelKey, row.value);
  }
  return config;
}

/**
 * Save partial config to database (keys stored as snake_case).
 * A null/undefined value removes the key so it reads back as null (not the text "null").
 * @param {Object} [partial={}] - Config keys and values to save
 */
async function saveConfig(partial = {}) {
  const keys = Object.keys(partial);
  for (const key of keys) {
    const snakeKey = humps.decamelize(key);
    const value = partial[key];
    if (value === null || value === undefined) {
      await runAsync("DELETE FROM app_config WHERE key = ?", [snakeKey]);
      continue;
    }
    await runAsync(
      "INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [snakeKey, String(value)]
    );
  }
}

module.exports = { defaultConfig, loadConfig, saveConfig };
