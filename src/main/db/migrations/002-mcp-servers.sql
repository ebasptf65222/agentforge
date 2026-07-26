-- AgentForge Schema Migration 002: MCP Servers
-- Adds mcp_servers table for P2-07/P2-08 MCP Client & Server Manager integration
-- Table structure based on MCPServerConfig from @shared/types (Spec v0.2 §5.5)

-- ─── Schema 版本记录 ───────────────────────────────────────────
INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (2, strftime('%s','now') * 1000, 'Add mcp_servers table for MCP integration');

-- ─── mcp_servers 表 ───────────────────────────────────────────
-- 存储 MCP Server 配置，支持 stdio 和 http 两种传输方式
-- args/env/headers 以 JSON 字符串存储

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
