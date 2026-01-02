-- schema.sql

CREATE TABLE IF NOT EXISTS cleaning_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cable_id TEXT NOT NULL,
  section_index_start INTEGER NOT NULL,
  section_index_end INTEGER NOT NULL,
  cleaning_method TEXT NOT NULL,
  cleaned_at TEXT NOT NULL,
  cleaning_count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_cleaning_events_cable ON cleaning_events (cable_id);
CREATE INDEX IF NOT EXISTS idx_cleaning_events_date ON cleaning_events (cleaned_at);

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
