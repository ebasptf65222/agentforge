import Database from 'better-sqlite3'
import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { app } from 'electron'

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

  throw new Error(`Schema file not found. Tried:\n${candidates.map((c) => `  - ${c}`).join('\n')}`)
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

  db = new Database(filePath)

  // PRAGMA 配置（Spec v0.2 §6.1）
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  // 执行 schema.sql 初始化
  const schemaPath = resolveSchemaPath()
  const schemaSql = readFileSync(schemaPath, 'utf-8')
  db.exec(schemaSql)

  return db
}

/**
 * 获取当前数据库实例。
 *
 * @returns Database 实例
 * @throws 如果尚未初始化则抛出
 */
export function getDatabase(): Database.Database {
  if (db === null) {
    throw new Error('Database not initialized. Call initDatabase() first.')
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
