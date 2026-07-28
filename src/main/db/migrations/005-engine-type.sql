-- AgentForge Schema Migration 005: Engine Type
-- Adds engine_type column to app_settings for Copilot SDK integration
-- Values: 'builtin' (default) | 'copilot-sdk'

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (9, strftime('%s','now') * 1000, 'Add engine_type column to app_settings for engine switching');

ALTER TABLE app_settings ADD COLUMN engine_type TEXT NOT NULL DEFAULT 'builtin';
