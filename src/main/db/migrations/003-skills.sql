-- AgentForge Schema Migration 003: Skills
-- Adds skills table for P3-01 Skills database table + CRUD
-- Table structure based on Skill from @shared/types (Spec v0.2 §5.6)

-- ─── Schema 版本记录 ───────────────────────────────────────────
INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (3, strftime('%s','now') * 1000, 'Add skills table for Skills system');

-- ─── skills 表 ───────────────────────────────────────────────
-- 存储 Skill 定义，支持 auto/manual 触发
-- allowed_tools/variables 以 JSON 字符串存储
-- name 唯一（用于意图匹配）；内置 Skill is_builtin=1 不可删除

CREATE TABLE IF NOT EXISTS skills (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  description   TEXT NOT NULL,
  prompt        TEXT NOT NULL,
  model_id      TEXT,
  allowed_tools TEXT NOT NULL DEFAULT '[]',   -- JSON array of tool names
  trigger       TEXT NOT NULL DEFAULT 'auto'
                CHECK(trigger IN ('auto', 'manual')),
  variables     TEXT NOT NULL DEFAULT '[]',   -- JSON array of SkillVariable
  is_builtin    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skills_trigger ON skills(trigger);
