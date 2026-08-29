-- AgentForge Schema Migration 008: Remove builtin engine
-- builtin 引擎已移除（三引擎 → 双引擎：copilot-sdk / langgraph）
-- 存量设置值为 'builtin' 的库迁移到新默认引擎 'copilot-sdk'
-- 注：实际执行逻辑位于 src/main/db/index.ts 的 runConditionalMigrations（幂等 UPDATE）

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (12, strftime('%s','now') * 1000, 'Remove builtin engine, migrate engine_type=builtin to copilot-sdk');

-- 迁移存量引擎设置（幂等：执行后不存在 builtin 值）
UPDATE app_settings SET engine_type = 'copilot-sdk' WHERE engine_type = 'builtin';
