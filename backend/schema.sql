-- schema.sql

-- Core cleaning events table (base schema without new columns - migrations add them)
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

-- Projects table to track all defined projects with their streamer configuration
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_number TEXT UNIQUE NOT NULL,
  project_name TEXT,
  vessel_tag TEXT DEFAULT 'TTN',
  created_at TEXT NOT NULL,
  is_active INTEGER DEFAULT 0,
  -- Streamer configuration per project
  num_cables INTEGER DEFAULT 12,
  sections_per_cable INTEGER DEFAULT 107,
  section_length INTEGER DEFAULT 75,
  module_frequency INTEGER DEFAULT 4,
  channels_per_section INTEGER DEFAULT 6,
  use_rope_for_tail INTEGER DEFAULT 1,
  deployment_date TEXT,
  is_coated INTEGER DEFAULT 0
);
