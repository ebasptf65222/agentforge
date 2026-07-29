-- AgentForge Schema Migration 007: Conversation Fork (P3-01)
-- Adds parent_id to conversations for conversation branching
-- Enables fork/restart from any point in conversation history

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (11, strftime('%s','now') * 1000, 'Add parent_id for conversation fork/branch support');

-- Add parent_id column to conversations table (nullable, foreign key to self)
ALTER TABLE conversations ADD COLUMN parent_id TEXT REFERENCES conversations(id) ON DELETE SET NULL;

-- Add fork_index column to track order among siblings (for tree reconstruction)
ALTER TABLE conversations ADD COLUMN fork_index INTEGER DEFAULT 0;

-- Add is_forked flag for quick filtering (0 = root/original, 1 = forked)
ALTER TABLE conversations ADD COLUMN is_forked INTEGER DEFAULT 0 CHECK(is_forked IN (0, 1));

-- Create index for parent-child queries
CREATE INDEX IF NOT EXISTS idx_conv_parent ON conversations(parent_id);

-- Create index for forked conversations
CREATE INDEX IF NOT EXISTS idx_conv_forked ON conversations(is_forked);
