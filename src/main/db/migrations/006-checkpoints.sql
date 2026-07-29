-- AgentForge Schema Migration 006: Checkpoints
-- Adds checkpoints table for file snapshot / rollback (P2-02)
-- Tracks file changes before writes/deletes for recovery

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (10, strftime('%s','now') * 1000, 'Add checkpoints table for file snapshot and rollback');

CREATE TABLE IF NOT EXISTS checkpoints (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id   TEXT,                        -- 关联的 Agent 执行 ID（可选，用于按执行追踪）
  conversation_id TEXT,                       -- 关联的会话 ID（可选）
  relative_path  TEXT NOT NULL,               -- 工作区相对路径
  original_content TEXT,                      -- 原始内容（NULL 表示文件之前不存在）
  new_content    TEXT NOT NULL,               -- 写入/变更后的内容
  action         TEXT NOT NULL                -- 'write' | 'delete' | 'rename'
                  CHECK(action IN ('write', 'delete', 'rename')),
  created_at     INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_execution ON checkpoints(execution_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_conversation ON checkpoints(conversation_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_path ON checkpoints(relative_path);
CREATE INDEX IF NOT EXISTS idx_checkpoints_created_at ON checkpoints(created_at DESC);
