-- AgentForge Schema Migration 004: Knowledge Base
-- Adds kb_documents and kb_chunks tables for P4-01
-- Tables based on KbDocument and DocumentChunk from @shared/types (Spec v0.2 §5.7)

-- ─── Schema 版本记录 ───────────────────────────────────────────

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (5, strftime('%s','now') * 1000, 'Add kb_documents and kb_chunks tables for Knowledge Base');

-- ─── kb_documents 表 ──────────────────────────────────────────
-- 存储知识库文档元信息
-- status: indexing → ready / error
-- file_type CHECK 限制支持的文件格式

CREATE TABLE IF NOT EXISTS kb_documents (
  id            TEXT PRIMARY KEY,
  file_path     TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  file_type     TEXT NOT NULL
                CHECK(file_type IN ('pdf', 'markdown', 'txt', 'docx', 'xlsx', 'csv')),
  chunk_count   INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'indexing'
                CHECK(status IN ('indexing', 'ready', 'error')),
  error_message TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_docs_status ON kb_documents(status);
CREATE INDEX IF NOT EXISTS idx_kb_docs_updated ON kb_documents(updated_at DESC);

-- ─── kb_chunks 表 ────────────────────────────────────────────
-- 文档分块表，存储文本块及其向量嵌入
-- embedding 以 JSON 数组字符串存储（number[]）
-- 外键 ON DELETE CASCADE：删除文档时自动删除关联分块

CREATE TABLE IF NOT EXISTS kb_chunks (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  token_count   INTEGER NOT NULL DEFAULT 0,
  chunk_index   INTEGER NOT NULL,
  embedding     TEXT,  -- JSON array of numbers, nullable until embedded
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_idx ON kb_chunks(document_id, chunk_index);
