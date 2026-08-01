import Database from 'better-sqlite3'
import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { app } from 'electron'
import { AppError, ErrorCodes } from '../utils/error'

// ─── 单例数据库实例 ─────────────────────────────────────────────
let db: Database.Database | null = null

/**
 * 解析 schema.sql 文件路径。
 * - 生产环境: electron-builder extraResources → process.resourcesPath/db/schema.sql
 * - 开发环境/测试: 从项目源码目录加载
 */
function resolveSchemaPath(): string {
  // 生产环境：process.resourcesPath 由 Electron 注入
  if (process.resourcesPath) {
    const prodPath = join(process.resourcesPath, 'db', 'schema.sql')
    if (existsSync(prodPath)) {
      return prodPath
    }
  }

  // 开发环境/测试：尝试多个候选路径
  const candidates = [
    // 1. 当前工作目录下的源码路径（vitest 测试）
    join(process.cwd(), 'src', 'main', 'db', 'schema.sql'),
    // 2. 编译输出目录旁（electron-vite dev）
    join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'),
    // 3. 从编译输出向上查找源码目录
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'main', 'db', 'schema.sql'),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  throw new AppError(
    ErrorCodes.DB_ERROR,
    `Schema file not found. Tried:\n${candidates.map((c) => `  - ${c}`).join('\n')}`,
    { candidates },
  )
}

/**
 * 初始化数据库连接，执行 PRAGMA 配置和 schema 初始化。
 *
 * 与 Spec v0.2 §6 一致：
 * - PRAGMA journal_mode = WAL
 * - PRAGMA foreign_keys = ON
 * - PRAGMA busy_timeout = 5000
 * - 5 张 P1 表 + 索引
 *
 * @param dbPath - 数据库文件路径，默认 app.getPath('userData')/agentforge.db
 * @returns Database 实例
 * @throws 初始化失败时抛出
 */
export function initDatabase(dbPath?: string): Database.Database {
  if (db !== null) {
    return db
  }

  const filePath = dbPath ?? join(app.getPath('userData'), 'agentforge.db')

  const newDb = new Database(filePath)

  try {
    // PRAGMA 配置（Spec v0.2 §6.1）
    newDb.pragma('journal_mode = WAL')
    newDb.pragma('foreign_keys = ON')
    newDb.pragma('busy_timeout = 5000')

    // 执行 schema.sql 初始化
    const schemaPath = resolveSchemaPath()
    const schemaSql = readFileSync(schemaPath, 'utf-8')
    newDb.exec(schemaSql)

    // 运行条件迁移（处理已存在数据库的 schema 变更）
    runConditionalMigrations(newDb)

    db = newDb
    return db
  } catch (error) {
    // OPT2-20: 初始化失败时关闭连接、清理全局实例，避免返回坏状态
    try { newDb.close() } catch { /* ignore */ }
    db = null
    throw error
  }
}

/**
 * 检查表是否存在指定列。
 */
function hasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.pragma(`table_info(${tableName})`) as Array<{ name: string }>
  return columns.some((c) => c.name === columnName)
}

// ─── 数据驱动的条件迁移定义 ─────────────────────────────────────

/**
 * 单个列迁移定义。
 */
interface ColumnMigration {
  /** 目标表名 */
  table: string
  /** 目标列名 */
  column: string
  /** 完整的 ALTER TABLE 语句 */
  sql: string
  /** 迁移说明（文档用途） */
  comment: string
}

/**
 * 所有需要条件添加的列。
 * 每条记录对应一个 `ALTER TABLE ... ADD COLUMN` 操作，
 * 通过 hasColumn 检查保证幂等性。
 */
const COLUMN_MIGRATIONS: readonly ColumnMigration[] = [
  {
    table: 'app_settings',
    column: 'voice',
    comment: 'V1-01: TTS/STT 语音配置',
    sql: `ALTER TABLE app_settings ADD COLUMN voice TEXT NOT NULL DEFAULT '{"tts":{"enabled":false,"provider":"openai","baseUrl":"https://api.openai.com/v1","apiKey":"","model":"tts-1","voice":"alloy","speed":1.0,"format":"mp3","autoPlay":false},"stt":{"enabled":false,"provider":"openai","baseUrl":"https://api.openai.com/v1","apiKey":"","model":"whisper-1","language":"","temperature":0.0},"mode":{"vadSilenceThreshold":1.5,"autoAwait":true}}'`,
  },
  {
    table: 'app_settings',
    column: 'workspace',
    comment: 'WS-01: 工作区配置',
    sql: `ALTER TABLE app_settings ADD COLUMN workspace TEXT NOT NULL DEFAULT '{"path":null,"recentPaths":[],"autoRestore":true,"excludePatterns":["node_modules",".git","dist",".DS_Store"]}'`,
  },
  {
    table: 'app_settings',
    column: 'engine_type',
    comment: 'SDK-02: 引擎类型（builtin/copilot-sdk/langgraph）',
    sql: `ALTER TABLE app_settings ADD COLUMN engine_type TEXT NOT NULL DEFAULT 'builtin'`,
  },
  {
    table: 'app_settings',
    column: 'copilot_reasoning_effort',
    comment: 'CE-05: SDK 推理强度',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_reasoning_effort TEXT`,
  },
  {
    table: 'app_settings',
    column: 'copilot_wire_api',
    comment: 'B5: SDK wire API 模式（completions/responses/auto）',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_wire_api TEXT`,
  },
  {
    table: 'app_settings',
    column: 'copilot_skill_directories',
    comment: 'B9: SDK 技能目录（JSON 数组）',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_skill_directories TEXT`,
  },
  {
    table: 'app_settings',
    column: 'copilot_enable_config_discovery',
    comment: 'B9: SDK 配置自动发现开关',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_enable_config_discovery INTEGER DEFAULT 0`,
  },
  {
    table: 'conversations',
    column: 'sdk_session_id',
    comment: 'CE-06: SDK session resume',
    sql: `ALTER TABLE conversations ADD COLUMN sdk_session_id TEXT DEFAULT NULL`,
  },
  {
    table: 'app_settings',
    column: 'copilot_context_tier',
    comment: 'P1-01: SDK 上下文层级',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_context_tier TEXT`,
  },
  {
    table: 'app_settings',
    column: 'copilot_reasoning_summary',
    comment: 'P1-02: SDK 推理摘要模式',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_reasoning_summary TEXT`,
  },
  {
    table: 'app_settings',
    column: 'copilot_excluded_tools',
    comment: 'P1-03: SDK 排除的工具列表',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_excluded_tools TEXT`,
  },
  {
    table: 'app_settings',
    column: 'copilot_enable_host_git_operations',
    comment: 'P1-04: SDK 主机 Git 操作开关',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_enable_host_git_operations INTEGER DEFAULT 1`,
  },
  {
    table: 'app_settings',
    column: 'copilot_tool_search_defer_threshold',
    comment: 'P2-01: SDK 工具搜索延迟阈值',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_tool_search_defer_threshold INTEGER`,
  },
  {
    table: 'app_settings',
    column: 'copilot_default_agent_excluded_tools',
    comment: 'P2-02: SDK 默认代理排除工具',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_default_agent_excluded_tools TEXT`,
  },
  {
    table: 'app_settings',
    column: 'copilot_plugin_directories',
    comment: 'P2-03: SDK Open Plugins 目录',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_plugin_directories TEXT`,
  },
  {
    table: 'app_settings',
    column: 'copilot_instruction_directories',
    comment: 'P2-04: SDK 自定义指令目录',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_instruction_directories TEXT`,
  },
  {
    table: 'app_settings',
    column: 'copilot_enable_memory',
    comment: 'P2-05: SDK 记忆功能开关',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_enable_memory INTEGER DEFAULT 0`,
  },
  {
    table: 'app_settings',
    column: 'copilot_skip_custom_instructions',
    comment: 'P2-06: SDK 跳过自定义指令开关',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_skip_custom_instructions INTEGER DEFAULT 0`,
  },
  {
    table: 'app_settings',
    column: 'copilot_enable_ask_user',
    comment: 'P3-01: SDK ask_user 交互开关',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_enable_ask_user INTEGER DEFAULT 0`,
  },
  {
    table: 'app_settings',
    column: 'copilot_enable_elicitation',
    comment: 'P3-02: SDK elicitation 表单交互开关',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_enable_elicitation INTEGER DEFAULT 0`,
  },
  {
    table: 'app_settings',
    column: 'copilot_agent_mode',
    comment: 'P3-03: SDK Agent 执行模式',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_agent_mode TEXT`,
  },
  {
    table: 'app_settings',
    column: 'copilot_max_prompt_tokens',
    comment: 'P3-04: SDK 最大提示词 token 数',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_max_prompt_tokens INTEGER`,
  },
  {
    table: 'app_settings',
    column: 'copilot_excluded_builtin_agents',
    comment: 'P3-05: SDK 排除的内置代理',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_excluded_builtin_agents TEXT`,
  },
  {
    table: 'app_settings',
    column: 'copilot_enable_skills',
    comment: 'P3-06: SDK 技能加载开关',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_enable_skills INTEGER DEFAULT 1`,
  },
  {
    table: 'app_settings',
    column: 'copilot_disabled_skills',
    comment: 'P3-07: SDK 禁用的技能列表',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_disabled_skills TEXT`,
  },
  {
    table: 'app_settings',
    column: 'copilot_infinite_session_threshold',
    comment: 'P3-08: SDK 上下文压缩阈值',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_infinite_session_threshold REAL`,
  },
  {
    table: 'app_settings',
    column: 'copilot_large_output_max_size',
    comment: 'P3-09: SDK 大输出最大字节数',
    sql: `ALTER TABLE app_settings ADD COLUMN copilot_large_output_max_size INTEGER`,
  },
  {
    table: 'app_settings',
    column: 'embedding_provider',
    comment: 'RAG-FIX-01: 嵌入模型 provider',
    sql: `ALTER TABLE app_settings ADD COLUMN embedding_provider TEXT DEFAULT 'ollama'`,
  },
  {
    table: 'app_settings',
    column: 'embedding_base_url',
    comment: 'RAG-FIX-01: 嵌入模型 base URL',
    sql: `ALTER TABLE app_settings ADD COLUMN embedding_base_url TEXT DEFAULT 'http://localhost:11434'`,
  },
  {
    table: 'app_settings',
    column: 'embedding_model',
    comment: 'RAG-FIX-01: 嵌入模型名称',
    sql: `ALTER TABLE app_settings ADD COLUMN embedding_model TEXT DEFAULT 'nomic-embed-text'`,
  },
  {
    table: 'app_settings',
    column: 'embedding_api_key',
    comment: 'RAG-FIX-01: 嵌入模型 API 密钥',
    sql: `ALTER TABLE app_settings ADD COLUMN embedding_api_key TEXT`,
  },
  {
    table: 'app_settings',
    column: 'embedding_dimensions',
    comment: 'RAG-FIX-01: 嵌入向量维度',
    sql: `ALTER TABLE app_settings ADD COLUMN embedding_dimensions INTEGER DEFAULT 768`,
  },
  {
    table: 'kb_documents',
    column: 'content_hash',
    comment: 'RAG-FIX-02: 文档内容哈希（快速去重）',
    sql: `ALTER TABLE kb_documents ADD COLUMN content_hash TEXT`,
  },
  {
    table: 'conversations',
    column: 'parent_id',
    comment: 'P3-01: 对话分支父 ID',
    sql: `ALTER TABLE conversations ADD COLUMN parent_id TEXT REFERENCES conversations(id) ON DELETE SET NULL`,
  },
  {
    table: 'conversations',
    column: 'fork_index',
    comment: 'P3-01: 对话分支索引',
    sql: `ALTER TABLE conversations ADD COLUMN fork_index INTEGER DEFAULT 0`,
  },
  {
    table: 'conversations',
    column: 'is_forked',
    comment: 'P3-01: 是否为分支会话',
    sql: `ALTER TABLE conversations ADD COLUMN is_forked INTEGER DEFAULT 0 CHECK(is_forked IN (0, 1))`,
  },
] as const

/**
 * 分支相关的索引（幂等，IF NOT EXISTS）。
 */
const INDEX_MIGRATIONS: readonly string[] = [
  `CREATE INDEX IF NOT EXISTS idx_conv_parent ON conversations(parent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_conv_forked ON conversations(is_forked)`,
] as const

/**
 * 检查表是否存在。
 */
function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(tableName) as { name: string } | undefined
  return row !== undefined
}

/**
 * 表创建迁移（幂等，通过 hasTable 检查）。
 */
const TABLE_MIGRATIONS: readonly { table: string; sql: string }[] = [
  {
    table: 'scheduled_tasks',
    sql: `CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      enabled         INTEGER NOT NULL DEFAULT 1,
      schedule_type   TEXT NOT NULL,
      cron_expr       TEXT,
      at_ms           INTEGER,
      every_ms        INTEGER,
      anchor_ms       INTEGER,
      timezone        TEXT,
      agent_config    TEXT NOT NULL,
      session_target  TEXT NOT NULL DEFAULT 'isolated',
      next_run_at_ms  INTEGER,
      running_at_ms   INTEGER,
      last_run_at_ms  INTEGER,
      last_status     TEXT,
      last_duration_ms INTEGER,
      run_count       INTEGER NOT NULL DEFAULT 0,
      error_count     INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    )`,
  },
  {
    table: 'scheduled_task_runs',
    sql: `CREATE TABLE IF NOT EXISTS scheduled_task_runs (
      id              TEXT PRIMARY KEY,
      task_id         TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
      started_at_ms   INTEGER NOT NULL,
      finished_at_ms  INTEGER,
      status          TEXT NOT NULL DEFAULT 'running',
      conversation_id TEXT,
      summary         TEXT,
      error           TEXT,
      duration_ms     INTEGER
    )`,
  },
] as const

/**
 * 调度器相关索引（幂等）。
 */
const SCHEDULER_INDEXES: readonly string[] = [
  `CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_enabled ON scheduled_tasks(enabled)`,
  `CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(next_run_at_ms)`,
  `CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_task ON scheduled_task_runs(task_id)`,
  `CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_status ON scheduled_task_runs(status)`,
] as const

/**
 * 条件迁移：为已存在的数据库添加缺失的列、表或索引。
 * 所有操作都是幂等的。
 *
 * 采用数据驱动方式：遍历 COLUMN_MIGRATIONS 数组，
 * 对每条记录通过 hasColumn 检查后执行对应的 ALTER TABLE。
 */
function runConditionalMigrations(db: Database.Database): void {
  // 列迁移：幂等地添加缺失的列
  COLUMN_MIGRATIONS.forEach((migration) => {
    if (!hasColumn(db, migration.table, migration.column)) {
      db.exec(migration.sql)
    }
  })

  // 表迁移：幂等地创建缺失的表
  TABLE_MIGRATIONS.forEach((migration) => {
    if (!hasTable(db, migration.table)) {
      db.exec(migration.sql)
    }
  })

  // 索引迁移：幂等地创建缺失的索引
  INDEX_MIGRATIONS.forEach((sql) => {
    db.exec(sql)
  })

  // 调度器索引
  SCHEDULER_INDEXES.forEach((sql) => {
    db.exec(sql)
  })
}

/**
 * 获取当前数据库实例。
 *
 * @returns Database 实例
 * @throws 如果尚未初始化则抛出
 */
export function getDatabase(): Database.Database {
  if (db === null) {
    throw new AppError(
      ErrorCodes.DB_ERROR,
      'Database not initialized. Call initDatabase() first.',
    )
  }
  return db
}

/**
 * 关闭数据库连接。
 * 在 before-quit 中调用（通过 registerCleanup 注册）。
 */
export function closeDatabase(): void {
  if (db !== null) {
    db.close()
    db = null
  }
}

/**
 * 获取当前 schema 版本号。
 *
 * @returns 版本号；如果 schema_version 表不存在则返回 0
 */
export function getSchemaVersion(): number {
  if (db === null) {
    return 0
  }
  const row = db
    .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined
  return row?.version ?? 0
}
