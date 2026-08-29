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
  sdk_session_id TEXT DEFAULT NULL,
  -- P3-01: 对话分支支持（列和索引由 runConditionalMigrations 添加）
  parent_id      TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  fork_index     INTEGER DEFAULT 0,
  is_forked      INTEGER DEFAULT 0 CHECK(is_forked IN (0, 1)),
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
  voice                TEXT NOT NULL DEFAULT '{"tts":{"enabled":false,"provider":"openai","baseUrl":"https://api.openai.com/v1","apiKey":"","model":"tts-1","voice":"alloy","speed":1.0,"format":"mp3","autoPlay":false},"stt":{"enabled":false,"provider":"openai","baseUrl":"https://api.openai.com/v1","apiKey":"","model":"whisper-1","language":"","temperature":0.0},"mode":{"vadSilenceThreshold":1.5,"autoAwait":true}}',
  workspace            TEXT NOT NULL DEFAULT '{"path":null,"recentPaths":[],"autoRestore":true,"excludePatterns":["node_modules",".git","dist",".DS_Store"]}',
  engine_type           TEXT NOT NULL DEFAULT 'copilot-sdk',
  embedding_provider    TEXT DEFAULT 'ollama',
  embedding_base_url    TEXT DEFAULT 'http://localhost:11434',
  embedding_model       TEXT DEFAULT 'nomic-embed-text',
  embedding_api_key     TEXT,
  embedding_dimensions  INTEGER DEFAULT 768,
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

-- ─── 6.8 skills (P3-01) ──────────────────────────────────────────
-- 存储 Skill 定义，支持 auto/manual 触发
-- allowed_tools/variables 以 JSON 字符串存储
-- name 唯一（用于意图匹配）；内置 Skill is_builtin=1 不可删除

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (3, strftime('%s','now') * 1000, 'Add skills table for Skills system');

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

-- ─── 6.9 内置 Skills 种子数据 (P3-05) ───────────────────────────
-- 插入两个内置 Skill：research-report 和 summarize-docs
-- 使用 INSERT OR IGNORE 确保只插入一次（name 唯一约束）
-- 内置 Skill 的 is_builtin=1，prompt 不可修改，仅允许更新 modelId

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (4, strftime('%s','now') * 1000, 'Seed built-in Skills: research-report, summarize-docs');

-- research-report: 根据主题生成结构化研究报告
INSERT OR IGNORE INTO skills
  (id, name, display_name, description, prompt, model_id, allowed_tools, trigger, variables, is_builtin, created_at, updated_at)
VALUES (
  'builtin-skill-research-report',
  'research-report',
  '研究报告生成',
  '根据用户提供的主题，进行网络搜索并生成结构化的研究报告。适用于需要深入分析、信息整理和专题研究的场景。',
  '你是一个专业的研究分析师。请根据用户提供的主题，生成一份结构化的研究报告。

报告结构：
1. **摘要** - 简要概述研究主题和核心发现
2. **背景** - 主题的背景信息和上下文
3. **现状分析** - 当前领域的发展现状和主要趋势
4. **关键发现** - 通过搜索和分析得到的关键信息点
5. **挑战与机遇** - 存在的挑战和潜在机会
6. **结论与建议** - 总结性结论和可行性建议

要求：
- 使用 web-search 工具搜索相关信息
- 使用 web-scrape 工具抓取关键网页的详细内容
- 确保信息来源可靠且最新
- 报告语言为中文，专业术语保留英文
- 研究主题：{{topic}}',
  NULL,
  '["web-search", "web-scrape"]',
  'auto',
  '[{"name":"topic","description":"研究报告的主题","required":true}]',
  1,
  strftime('%s','now') * 1000,
  strftime('%s','now') * 1000
);

-- summarize-docs: 对长文本或文档进行摘要总结
INSERT OR IGNORE INTO skills
  (id, name, display_name, description, prompt, model_id, allowed_tools, trigger, variables, is_builtin, created_at, updated_at)
VALUES (
  'builtin-skill-summarize-docs',
  'summarize-docs',
  '文档摘要',
  '对长文本或文档进行智能摘要总结，提取核心要点。适用于需要快速了解文档内容的场景。',
  '你是一个专业的文档摘要助手。请对用户提供的内容进行结构化摘要。

摘要结构：
1. **核心概要** - 一句话概括文档主旨（不超过50字）
2. **关键要点** - 提取3-5个核心要点，每个要点1-2句话
3. **重要细节** - 值得关注的数据、引用或事实
4. **行动建议** - 基于内容提出的后续行动建议（如有）

要求：
- 保持客观，不添加原文中没有的信息
- 摘要应简洁明了，避免冗余
- 保留关键数据和具体数字
- 如原文有明确立场，摘要应如实反映
- 摘要风格：{{style}}
- 待摘要内容：{{content}}',
  NULL,
  '["file-read"]',
  'auto',
  '[{"name":"content","description":"需要摘要的文档内容","required":true},{"name":"style","description":"摘要风格（简洁/详细/要点）","required":false,"defaultValue":"简洁"}]',
  1,
  strftime('%s','now') * 1000,
  strftime('%s','now') * 1000
);

-- ─── 6.10 kb_documents (P4-01) ──────────────────────────────────
-- 知识库文档表，存储导入的文档元信息
-- status: indexing → ready / error
-- file_type CHECK 限制支持的文件格式

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (5, strftime('%s','now') * 1000, 'Add kb_documents and kb_chunks tables for Knowledge Base');

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
  content_hash  TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_docs_status ON kb_documents(status);
CREATE INDEX IF NOT EXISTS idx_kb_docs_updated ON kb_documents(updated_at DESC);

-- ─── 6.11 kb_chunks (P4-01) ─────────────────────────────────────
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

-- ─── 6.11 voice config (V1-01) ───────────────────────────────
-- 语音配置，存储 TTS/STT/语音模式设置
-- 以 JSON 字符串存储在 app_settings 的 voice 列中
-- 注意：voice 列已在 app_settings 建表时定义，此处仅记录版本

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (6, strftime('%s','now') * 1000, 'Add voice column to app_settings for TTS/STT configuration');

-- ─── 6.12 kg_entities (KG-01) ────────────────────────────────
-- 知识图谱实体表，存储提取的实体节点

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (7, strftime('%s','now') * 1000, 'Add kg_entities and kg_relations tables for Knowledge Graph');

CREATE TABLE IF NOT EXISTS kg_entities (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL,
  description   TEXT,
  source_doc_id TEXT,
  confidence    REAL NOT NULL DEFAULT 1.0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kg_entities_name ON kg_entities(name);
CREATE INDEX IF NOT EXISTS idx_kg_entities_type ON kg_entities(type);

-- ─── 6.13 kg_relations (KG-01) ────────────────────────────────
-- 知识图谱关系表，存储实体之间的关系

CREATE TABLE IF NOT EXISTS kg_relations (
  id            TEXT PRIMARY KEY,
  source_id     TEXT NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
  target_id     TEXT NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
  relation      TEXT NOT NULL,
  description   TEXT,
  source_doc_id TEXT,
  confidence    REAL NOT NULL DEFAULT 1.0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kg_relations_source ON kg_relations(source_id);
CREATE INDEX IF NOT EXISTS idx_kg_relations_target ON kg_relations(target_id);
CREATE INDEX IF NOT EXISTS idx_kg_relations_relation ON kg_relations(relation);

-- ─── 6.14 workspace config (WS-01) ───────────────────────────
-- 工作区配置，存储本地文件工作区设置
-- 以 JSON 字符串存储在 app_settings 的 workspace 列中
-- 注意：workspace 列已在 app_settings 建表时定义，此处仅记录版本

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (8, strftime('%s','now') * 1000, 'Add workspace column to app_settings for local file workspace');

-- ─── 6.15 copilot reasoning effort (CE-05) ──────────────────
-- Copilot SDK 推理强度配置，存储在 app_settings 的 copilot_reasoning_effort 列中
-- 值为 'low' | 'medium' | 'high' | 'xhigh'，NULL 表示使用 SDK 默认值

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (9, strftime('%s','now') * 1000, 'Add copilot_reasoning_effort column to app_settings for SDK reasoning control');

-- ─── 6.16 prompt_templates (PT-01) ────────────────────────────
-- Prompt 模板库，保存和复用常用 prompt 模板
-- variables 以 JSON 字符串数组存储（变量名列表）

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (10, strftime('%s','now') * 1000, 'Add prompt_templates table for Prompt Template Library');

CREATE TABLE IF NOT EXISTS prompt_templates (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'general',
  variables   TEXT NOT NULL DEFAULT '[]',  -- JSON array of variable names
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_category ON prompt_templates(category);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_updated ON prompt_templates(updated_at DESC);

-- ─── 6.17 conversations.sdk_session_id (CE-06) ────────────────
-- 为 conversations 表添加 sdk_session_id 列，存储 SDK 分配的 sessionId
-- 用于应用重启后通过 client.resumeSession 恢复之前的对话上下文
-- 注意：CREATE TABLE IF NOT EXISTS 不会为已存在的表添加列，
--       已有数据库的列添加由 db/index.ts 的 runConditionalMigrations 处理

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (11, strftime('%s','now') * 1000, 'Add sdk_session_id column to conversations for SDK session resume');

-- ─── 6.18 copilot_wire_api (B5) ──────────────────────────────
-- Copilot SDK wire API 模式配置，存储在 app_settings 的 copilot_wire_api 列中
-- 值为 'completions' | 'responses'，NULL 表示 'auto'（根据模型类型自动判断）
-- 'responses' 模式支持多轮状态、工具命名空间、推理支持（GPT-4o/o 系列推荐）
-- 注意：已有数据库的列添加由 db/index.ts 的 runConditionalMigrations 处理

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (12, strftime('%s','now') * 1000, 'Add copilot_wire_api column to app_settings for SDK Responses API mode control');

-- ─── 6.19 copilot_skill_directories (B9) ──────────────────────
-- Copilot SDK 技能目录路径列表（JSON 数组），SDK 会从这些目录加载 .md 技能文件
-- NULL 表示未配置（不传入 skillDirectories）
-- 注意：已有数据库的列添加由 db/index.ts 的 runConditionalMigrations 处理

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (13, strftime('%s','now') * 1000, 'Add copilot_skill_directories column to app_settings for SDK skill directory loading');

-- ─── 6.20 copilot_enable_config_discovery (B9) ────────────────
-- 是否启用配置自动发现（.mcp.json、skill 目录等）
-- 0 表示禁用（默认），1 表示启用
-- 注意：已有数据库的列添加由 db/index.ts 的 runConditionalMigrations 处理

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (14, strftime('%s','now') * 1000, 'Add copilot_enable_config_discovery column to app_settings for SDK config auto-discovery');

-- ─── 6.21 copilot_context_tier (P1-01) ────────────────────────
-- SDK 上下文窗口层级：'default' 或 'long_context'
-- 注意：已有数据库的列添加由 db/index.ts 的 runConditionalMigrations 处理

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (15, strftime('%s','now') * 1000, 'Add copilot_context_tier column to app_settings for SDK context tier');

-- ─── 6.22 copilot_reasoning_summary (P1-02) ───────────────────
-- SDK 推理摘要模式：'none' | 'auto' | 'detailed'
-- 注意：已有数据库的列添加由 db/index.ts 的 runConditionalMigrations 处理

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (16, strftime('%s','now') * 1000, 'Add copilot_reasoning_summary column to app_settings for SDK reasoning summary');

-- ─── 6.23 copilot_excluded_tools (P1-03) ──────────────────────
-- SDK 排除的工具列表（JSON 数组）
-- 注意：已有数据库的列添加由 db/index.ts 的 runConditionalMigrations 处理

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (17, strftime('%s','now') * 1000, 'Add copilot_excluded_tools column to app_settings for SDK excluded tools');

-- ─── 6.24 copilot_enable_host_git_operations (P1-04) ──────────
-- SDK 是否启用主机 Git 操作：0 表示禁用，1 表示启用（默认）
-- 注意：已有数据库的列添加由 db/index.ts 的 runConditionalMigrations 处理

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (18, strftime('%s','now') * 1000, 'Add copilot_enable_host_git_operations column to app_settings for SDK host git operations');

-- ─── 6.25 copilot_tool_search_defer_threshold (P2-01) ─────────
-- SDK 工具搜索延迟加载阈值（0 表示使用 SDK 默认 30）
-- 注意：已有数据库的列添加由 db/index.ts 的 runConditionalMigrations 处理

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (19, strftime('%s','now') * 1000, 'Add copilot_tool_search_defer_threshold column to app_settings for SDK tool search config');

-- ─── 6.26 copilot_default_agent_excluded_tools (P2-02) ────────
-- SDK 默认代理排除的工具列表（JSON 数组）
-- 注意：已有数据库的列添加由 db/index.ts 的 runConditionalMigrations 处理

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (20, strftime('%s','now') * 1000, 'Add copilot_default_agent_excluded_tools column to app_settings for SDK default agent config');

-- ─── 6.27 copilot_plugin_directories (P2-03) ──────────────────
-- SDK Open Plugins 目录路径列表（JSON 数组）
-- 注意：已有数据库的列添加由 db/index.ts 的 runConditionalMigrations 处理

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (21, strftime('%s','now') * 1000, 'Add copilot_plugin_directories column to app_settings for SDK plugin directories');

-- ─── 6.28 copilot_instruction_directories (P2-04) ─────────────
-- SDK 自定义指令文件目录列表（JSON 数组）
-- 注意：已有数据库的列添加由 db/index.ts 的 runConditionalMigrations 处理

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (22, strftime('%s','now') * 1000, 'Add copilot_instruction_directories column to app_settings for SDK instruction directories');

-- ─── 6.29 copilot_enable_memory (P2-05) ───────────────────────
-- SDK 是否启用记忆功能：0 表示禁用，1 表示启用
-- 注意：已有数据库的列添加由 db/index.ts 的 runConditionalMigrations 处理

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (23, strftime('%s','now') * 1000, 'Add copilot_enable_memory column to app_settings for SDK memory feature');

-- ─── 6.30 copilot_skip_custom_instructions (P2-06) ────────────
-- SDK 是否跳过自定义指令文件：0 表示不跳过（默认），1 表示跳过
-- 注意：已有数据库的列添加由 db/index.ts 的 runConditionalMigrations 处理

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (24, strftime('%s','now') * 1000, 'Add copilot_skip_custom_instructions column to app_settings for SDK skip custom instructions');

-- ─── Phase 3: 高级 SDK 配置项 ───────────────────────────────

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (25, strftime('%s','now') * 1000, 'Add copilot_enable_ask_user column for SDK ask_user tool');

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (26, strftime('%s','now') * 1000, 'Add copilot_enable_elicitation column for SDK elicitation forms');

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (27, strftime('%s','now') * 1000, 'Add copilot_agent_mode column for SDK agentMode (plan/autopilot/shell)');

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (28, strftime('%s','now') * 1000, 'Add copilot_max_prompt_tokens column for SDK maxPromptTokens compression threshold');

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (29, strftime('%s','now') * 1000, 'Add copilot_excluded_builtin_agents column for SDK excludedBuiltinAgents');

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (30, strftime('%s','now') * 1000, 'Add copilot_enable_skills column for SDK skill loading toggle');

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (31, strftime('%s','now') * 1000, 'Add copilot_disabled_skills column for SDK disabledSkills list');

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (32, strftime('%s','now') * 1000, 'Add copilot_infinite_session_threshold column for SDK compression threshold');

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (33, strftime('%s','now') * 1000, 'Add copilot_large_output_max_size column for SDK largeOutput max size');

-- ─── 6.34 嵌入模型配置 (RAG-FIX-01) ───────────────────────────
-- 知识库嵌入模型配置，存储在 app_settings 表中
-- embedding_provider: 'ollama' | 'openai'（默认 'ollama'）
-- embedding_base_url: API 基础 URL
-- embedding_model: 模型名称
-- embedding_api_key: API 密钥（OpenAI 必需）
-- embedding_dimensions: 向量维度（用于校验）
-- 注意：已有数据库的列添加由 db/index.ts 的 runConditionalMigrations 处理

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (34, strftime('%s','now') * 1000, 'Add embedding config columns to app_settings for RAG embedding model configuration');

-- ─── 6.35 kb_documents.content_hash (RAG-FIX-02) ──────────────
-- 为 kb_documents 表添加 content_hash 列（SHA-256），用于快速内容去重
-- 避免每次导入都遍历所有文档分块重新拼接计算哈希
-- 注意：已有数据库的列添加由 db/index.ts 的 runConditionalMigrations 处理

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (35, strftime('%s','now') * 1000, 'Add content_hash column to kb_documents for fast dedup');

-- ─── 6.36 codebase_files (CB-01) ──────────────────────────────
-- 代码库索引文件表，记录已扫描的源代码文件
-- status: pending → indexing → ready / error
-- language: 检测到的编程语言
-- file_hash: SHA-256 文件内容哈希（用于增量扫描变更检测）

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (36, strftime('%s','now') * 1000, 'Add codebase_files table for codebase indexing');

CREATE TABLE IF NOT EXISTS codebase_files (
  id            TEXT PRIMARY KEY,
  file_path     TEXT NOT NULL UNIQUE,
  file_name     TEXT NOT NULL,
  language      TEXT NOT NULL,
  file_hash     TEXT NOT NULL,
  line_count    INTEGER NOT NULL DEFAULT 0,
  symbol_count  INTEGER NOT NULL DEFAULT 0,
  chunk_count   INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending', 'indexing', 'ready', 'error')),
  error_message TEXT,
  indexed_at    INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cb_files_language ON codebase_files(language);
CREATE INDEX IF NOT EXISTS idx_cb_files_status ON codebase_files(status);
CREATE INDEX IF NOT EXISTS idx_cb_files_hash ON codebase_files(file_hash);

-- ─── 6.37 codebase_symbols (CB-02) ───────────────────────────
-- 代码符号表，存储从源码中提取的函数、类、接口等符号
-- symbol_type: function | method | class | interface | type | variable | import | export
-- visibility: public | private | protected | default

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (37, strftime('%s','now') * 1000, 'Add codebase_symbols table for code symbol indexing');

CREATE TABLE IF NOT EXISTS codebase_symbols (
  id            TEXT PRIMARY KEY,
  file_id       TEXT NOT NULL REFERENCES codebase_files(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  qualified_name TEXT NOT NULL,
  symbol_type   TEXT NOT NULL
                CHECK(symbol_type IN ('function', 'method', 'class', 'interface', 'type', 'variable', 'import', 'export', 'constant', 'enum')),
  visibility    TEXT DEFAULT 'default'
                CHECK(visibility IN ('public', 'private', 'protected', 'default')),
  signature     TEXT,
  start_line    INTEGER NOT NULL,
  end_line      INTEGER NOT NULL,
  doc_comment   TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cb_symbols_file ON codebase_symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_cb_symbols_name ON codebase_symbols(name);
CREATE INDEX IF NOT EXISTS idx_cb_symbols_type ON codebase_symbols(symbol_type);
CREATE INDEX IF NOT EXISTS idx_cb_symbols_qualified ON codebase_symbols(qualified_name);

-- ─── 6.38 codebase_chunks (CB-03) ────────────────────────────
-- 代码分块表，存储代码片段及其向量嵌入（用于语义搜索）
-- chunk_type: module | function | class | block | comment
-- embedding: JSON 数格式的向量嵌入（nullable until embedded）

INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (38, strftime('%s','now') * 1000, 'Add codebase_chunks table for code chunk embedding and search');

CREATE TABLE IF NOT EXISTS codebase_chunks (
  id            TEXT PRIMARY KEY,
  file_id       TEXT NOT NULL REFERENCES codebase_files(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  chunk_type    TEXT NOT NULL DEFAULT 'block'
                CHECK(chunk_type IN ('module', 'function', 'class', 'block', 'comment')),
  symbol_id     TEXT,
  start_line    INTEGER NOT NULL,
  end_line      INTEGER NOT NULL,
  token_count   INTEGER NOT NULL DEFAULT 0,
  chunk_index   INTEGER NOT NULL,
  embedding     TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cb_chunks_file ON codebase_chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_cb_chunks_idx ON codebase_chunks(file_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_cb_chunks_symbol ON codebase_chunks(symbol_id);
