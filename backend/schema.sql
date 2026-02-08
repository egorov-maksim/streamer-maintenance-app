-- Complete database schema for Streamer Maintenance App
-- Fresh installation schema with streamer_id (no migrations)

-- Enable foreign key constraints and WAL mode
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- Application configuration table
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Cleaning events table - tracks all cleaning operations
CREATE TABLE IF NOT EXISTS cleaning_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  streamer_id INTEGER NOT NULL,
  section_index_start INTEGER NOT NULL,
  section_index_end INTEGER NOT NULL,
  cleaning_method TEXT NOT NULL,
  cleaned_at TEXT NOT NULL,
  cleaning_count INTEGER DEFAULT 1,
  project_number TEXT,
  vessel_tag TEXT DEFAULT 'TTN',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_number) REFERENCES projects(project_number) ON DELETE CASCADE
);

-- Indexes for cleaning_events
CREATE INDEX IF NOT EXISTS idx_cleaning_events_streamer ON cleaning_events(streamer_id);
CREATE INDEX IF NOT EXISTS idx_cleaning_events_date ON cleaning_events(cleaned_at);
CREATE INDEX IF NOT EXISTS idx_cleaning_events_project ON cleaning_events(project_number);

-- Projects table - tracks all defined projects with their streamer configuration
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_number TEXT UNIQUE NOT NULL,
  project_name TEXT,
  vessel_tag TEXT DEFAULT 'TTN',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active INTEGER DEFAULT 0,
  num_cables INTEGER DEFAULT 12,
  sections_per_cable INTEGER DEFAULT 107,
  section_length INTEGER DEFAULT 75,
  module_frequency INTEGER DEFAULT 4,
  channels_per_section INTEGER DEFAULT 6,
  use_rope_for_tail INTEGER DEFAULT 1
);

-- Streamer deployments table - per-streamer deployment configuration
CREATE TABLE IF NOT EXISTS streamer_deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  streamer_id INTEGER NOT NULL,
  deployment_date TEXT,
  is_coated INTEGER,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, streamer_id)
);

-- Index for streamer_deployments
CREATE INDEX IF NOT EXISTS idx_streamer_deployments_project ON streamer_deployments(project_id);
