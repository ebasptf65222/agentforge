-- AgentForge Schema Migration 003: Skills
-- Adds skills table for P3-01 Skills database table + CRUD
-- + P3-05: Seed built-in Skills (research-report, summarize-docs)
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

-- ─── P3-05: 内置 Skills 种子数据 ──────────────────────────────

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
