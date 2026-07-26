-- AgentForge Database Schema v1
-- 与 Spec v0.2 §6 一致
-- P1 初始 Schema，version = 1

-- ─── 6.1 PRAGMA 配置（连接初始化时执行，不在此处）───
-- 在 db/index.ts 中执行 PRAGMA journal_mode=WAL / foreign_keys=ON / busy_timeout=5000

-- ─── 6.2 Schema 版本管理 ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  description TEXT
);
INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (1, strftime('%s','now') * 1000, 'Initial schema - P1 tables');

-- ─── 6.5 model_configs（先建表，因为 conversations 依赖它）───

CREATE TABLE IF NOT EXISTS model_configs (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  provider      TEXT NOT NULL
                CHECK(provider IN ('openai', 'deepseek', 'anthropic', 'custom')),
  model_id      TEXT NOT NULL,
  api_key       TEXT NOT NULL,
  base_url      TEXT,
  temperature   REAL NOT NULL DEFAULT 0.7,
  max_tokens    INTEGER NOT NULL DEFAULT 4096,
  is_default    INTEGER NOT NULL DEFAULT 0,
  capabilities  TEXT NOT NULL DEFAULT '{"streaming":true,"toolUse":false,"vision":false,"maxContextLength":4096}',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE(provider, model_id)
);

-- ─── 6.3 conversations ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversations (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  model_id       TEXT NOT NULL REFERENCES model_configs(id),
  approval_mode  TEXT NOT NULL DEFAULT 'auto-edit'
                 CHECK(approval_mode IN ('suggest', 'auto-edit', 'full-auto')),
  message_count  INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC);

-- ─── 6.4 messages ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL
                  CHECK(role IN ('user', 'assistant', 'system', 'tool')),
  content         TEXT NOT NULL DEFAULT '',
  thinking        TEXT,
  tool_calls      TEXT,
  metadata        TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

-- ─── 6.6 app_settings ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_settings (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  theme                TEXT NOT NULL DEFAULT 'dark',
  default_approval_mode TEXT NOT NULL DEFAULT 'auto-edit',
  max_execution_steps  INTEGER NOT NULL DEFAULT 20,
  default_model_id     TEXT,
  shortcuts            TEXT NOT NULL DEFAULT '{"newConversation":"CmdOrCtrl+N","sendMessage":"Enter","stopGeneration":"CmdOrCtrl+.","toggleSidebar":"CmdOrCtrl+B"}',
  approval_timeout_ms  INTEGER NOT NULL DEFAULT 300000,
  window_bounds        TEXT,
  updated_at           INTEGER NOT NULL
);
INSERT OR IGNORE INTO app_settings (id, updated_at) VALUES (1, strftime('%s','now') * 1000);

-- ─── 6.7 mcp_servers (P2-07/P2-08) ────────────────────────────
-- 存储 MCP Server 配置，支持 stdio 和 http 两种传输方式
-- args/env/headers 以 JSON 字符串存储

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (2, strftime('%s','now') * 1000, 'Add mcp_servers table for MCP integration');

CREATE TABLE IF NOT EXISTS mcp_servers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  transport   TEXT NOT NULL CHECK(transport IN ('stdio', 'http')),
  command     TEXT,
  args        TEXT,  -- JSON array
  env         TEXT,  -- JSON object
  url         TEXT,
  headers     TEXT,  -- JSON object
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
