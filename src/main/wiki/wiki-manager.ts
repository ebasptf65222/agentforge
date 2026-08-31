// AgentForge LLM Wiki - Karpathy 模式核心管理模块
// 三层架构：raw/（原始资料）→ wiki/（编译知识）→ rules/（规则定义）
// 三操作：Ingest（编译）、Query（查询）、Lint（健康检查）

import { readFile, writeFile, appendFile, readdir, stat, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, relative, extname, basename } from 'node:path'
import { getWorkspacePath } from '../ipc/workspace'
import { AppError, ErrorCodes } from '../utils/error'
import { parseDocument } from '../knowledge-base/parser'

// ─── 类型定义 ───────────────────────────────────────────────────

export interface WikiStats {
  rawCount: number
  wikiPageCount: number
  lastIngest: string | null
  lastLint: string | null
  totalWikiSize: number
}

export interface WikiPageInfo {
  path: string
  title: string
  category: string
  summary: string
  lastModified: number
  linkedFrom: string[]
}

export interface WikiLintResult {
  issues: WikiLintIssue[]
  passed: boolean
  summary: string
}

export interface WikiLintIssue {
  type: 'contradiction' | 'stale' | 'orphan' | 'missing_ref' | 'missing_page' | 'gap'
  severity: 'warning' | 'error' | 'info'
  page: string
  description: string
}

// ─── 常量 ───────────────────────────────────────────────────────

const WIKI_DIRS = ['raw', 'wiki', 'rules'] as const
const SPECIAL_FILES = {
  INDEX: 'index.md',
  LOG: 'log.md',
  SCHEMA: 'AGENTS.md',
} as const

// ─── 核心操作 ──────────────────────────────────────────────────

/**
 * 获取 Wiki 工作区根路径。
 * LLM Wiki 部署在工作区下的 .llm-wiki/ 目录中。
 */
export function getWikiPath(): string {
  const wsPath = getWorkspacePath()
  return join(wsPath, '.llm-wiki')
}

/**
 * 初始化 Wiki 工作区结构。
 * 在工作区下创建 .llm-wiki/ 目录结构：
 *   .llm-wiki/
 *     raw/          ← 原始资料（不可变）
 *     wiki/         ← LLM 编译的 Markdown 页面
 *     rules/        ← 规则与 Schema 定义
 *     index.md      ← 内容目录（LLM 优先读取）
 *     log.md        ← 活动日志（追加写入）
 *     AGENTS.md     ← Schema 配置文件
 *
 * 幂等：目录已存在时不会报错。
 */
export async function initWikiWorkspace(): Promise<void> {
  const wikiPath = getWikiPath()

  // 创建三层目录
  for (const dir of WIKI_DIRS) {
    await mkdir(join(wikiPath, dir), { recursive: true })
  }

  // 创建 AGENTS.md（Schema 层）
  const schemaPath = join(wikiPath, SPECIAL_FILES.SCHEMA)
  if (!existsSync(schemaPath)) {
    await writeFile(schemaPath, getDefaultSchema(), 'utf-8')
  }

  // 创建 index.md（内容目录）
  const indexPath = join(wikiPath, SPECIAL_FILES.INDEX)
  if (!existsSync(indexPath)) {
    await writeFile(indexPath, getDefaultIndex(), 'utf-8')
  }

  // 创建 log.md（活动日志）
  const logPath = join(wikiPath, SPECIAL_FILES.LOG)
  if (!existsSync(logPath)) {
    await writeFile(logPath, getDefaultLog(), 'utf-8')
  }
}

/**
 * 检查 Wiki 工作区是否已初始化。
 */
export async function isWikiInitialized(): Promise<boolean> {
  const wikiPath = getWikiPath()
  if (!existsSync(wikiPath)) return false
  for (const dir of WIKI_DIRS) {
    if (!existsSync(join(wikiPath, dir))) return false
  }
  return true
}

// ─── Raw 资料操作 ──────────────────────────────────────────────

/** 允许直接按纯文本导入的扩展名（小写，含点） */
const TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.mdx', '.txt', '.csv', '.tsv', '.json', '.jsonl',
  '.html', '.htm', '.xml', '.yaml', '.yml', '.rst', '.log', '.ini', '.toml',
])

/** 需要解析转换的二进制文档格式 → parser fileType（复用 KB 解析器） */
const BINARY_DOC_EXTENSIONS: Record<string, 'pdf' | 'docx' | 'xlsx'> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
}

/**
 * 将文件放置到 raw/ 目录（复制/链接）。
 * - 纯文本格式：按 utf-8 原样复制
 * - PDF/DOCX/XLSX：解析提取文本后以 Markdown 形式存入 raw/（保留原始扩展名以便溯源）
 * @param sourcePath - 源文件绝对路径
 * @returns raw/ 中的相对路径
 * @throws {AppError} VALIDATION_ERROR - 不支持的文件格式或解析结果为空
 */
export async function addRawSource(sourcePath: string): Promise<string> {
  const wikiPath = getWikiPath()
  const rawDir = join(wikiPath, 'raw')

  const ext = extname(sourcePath).toLowerCase()
  const fileName = basename(sourcePath)
  let destName: string
  let content: string

  if (ext in BINARY_DOC_EXTENSIONS) {
    // 二进制文档：解析为文本（PDF/Word/Excel），扫描版 PDF 等无文本内容时会报错
    const fileType = BINARY_DOC_EXTENSIONS[ext]
    const parsed = await parseDocument(sourcePath, fileType)
    if (parsed.content.trim() === '') {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `解析 ${fileType.toUpperCase()} 文件未提取到任何文本内容: ${fileName}。扫描版 PDF（图片型）暂不支持，请先使用 OCR 转换为文本。`,
        { sourcePath, ext },
      )
    }
    content = parsed.content
    destName = `${fileName}.md`
  } else if (TEXT_EXTENSIONS.has(ext)) {
    content = await readFile(sourcePath, 'utf-8')
    destName = fileName
  } else {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `不支持的文件格式: ${ext || '(无扩展名)'}。LLM Wiki 支持纯文本格式（md/txt/csv/json/html/xml/yaml 等）及 PDF、Word（.docx）、Excel（.xlsx）文档。`,
      { sourcePath, ext },
    )
  }

  // 写入 raw/ 目录（不可变副本）
  const destPath = join(rawDir, destName)
  await writeFile(destPath, content, 'utf-8')

  // 统一使用正斜杠：Windows 上 relative() 返回反斜杠路径，
  // 会导致消费方 replace('raw/', '') 前缀剥离失败（历史索引失败根因）
  return relative(wikiPath, destPath).replace(/\\/g, '/')
}

/**
 * 读取 raw/ 中的原始资料内容。
 * @param relativePath - 相对于 .llm-wiki/raw/ 的路径
 */
export async function readRawSource(relativePath: string): Promise<string> {
  const wikiPath = getWikiPath()
  const absPath = join(wikiPath, 'raw', relativePath)

  if (!existsSync(absPath)) {
    throw new AppError(ErrorCodes.FILE_NOT_FOUND, `Raw source not found: ${relativePath}`)
  }

  return await readFile(absPath, 'utf-8')
}

/**
 * 列出 raw/ 中的所有原始资料。
 */
export async function listRawSources(): Promise<string[]> {
  const wikiPath = getWikiPath()
  const rawDir = join(wikiPath, 'raw')

  if (!existsSync(rawDir)) return []

  const entries = await readdir(rawDir)
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(rawDir, entry)
    const stats = await stat(fullPath)
    if (stats.isFile()) {
      files.push(entry)
    }
  }

  return files.sort()
}

// ─── Wiki 页面操作 ─────────────────────────────────────────────

/**
 * 获取 wiki/ 中所有页面的基本信息。
 */
export async function listWikiPages(): Promise<WikiPageInfo[]> {
  const wikiPath = getWikiPath()
  const wikiDir = join(wikiPath, 'wiki')

  if (!existsSync(wikiDir)) return []

  const pages: WikiPageInfo[] = []

  async function scanDir(dir: string, category: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await scanDir(fullPath, entry.name)
      } else if (
        entry.name.endsWith('.md') &&
        entry.name !== SPECIAL_FILES.INDEX &&
        entry.name !== SPECIAL_FILES.LOG // 防止 LLM 误写到 wiki/ 下的 log.md 被当成知识页面
      ) {
        // 统一使用正斜杠（Windows 上 relative() 返回反斜杠，会导致 index 链接与 page_path 查询失效）
        const relPath = relative(wikiDir, fullPath).replace(/\\/g, '/')
        const content = await readFile(fullPath, 'utf-8')
        const title = extractTitle(content) || entry.name.replace('.md', '')
        const summary = extractSummary(content)
        const stats = await stat(fullPath)

        pages.push({
          path: relPath,
          title,
          category,
          summary,
          lastModified: stats.mtimeMs,
          linkedFrom: [],
        })
      }
    }
  }

  await scanDir(wikiDir, 'root')
  return pages.sort((a, b) => a.title.localeCompare(b.title))
}

/**
 * 读取 wiki/ 中页面的内容。
 * @param pagePath - 相对于 wiki/ 的路径
 */
export async function readWikiPage(pagePath: string): Promise<string> {
  const wikiPath = getWikiPath()
  const absPath = join(wikiPath, 'wiki', pagePath)

  if (!existsSync(absPath)) {
    throw new AppError(ErrorCodes.FILE_NOT_FOUND, `Wiki page not found: ${pagePath}`)
  }

  return await readFile(absPath, 'utf-8')
}

/**
 * 写入 wiki/ 页面（由 LLM 调用 file_write 完成）。
 * @param pagePath - 相对于 wiki/ 的路径
 * @param content - Markdown 内容
 */
export async function writeWikiPage(pagePath: string, content: string): Promise<void> {
  const wikiPath = getWikiPath()
  const absPath = join(wikiPath, 'wiki', pagePath)

  // 确保父目录存在
  await mkdir(join(absPath, '..'), { recursive: true })
  await writeFile(absPath, content, 'utf-8')
}

// ─── Index 管理 ────────────────────────────────────────────────

/**
 * 读取 index.md 内容。
 */
export async function readIndex(): Promise<string> {
  const wikiPath = getWikiPath()
  const indexPath = join(wikiPath, SPECIAL_FILES.INDEX)
  if (!existsSync(indexPath)) return getDefaultIndex()
  return await readFile(indexPath, 'utf-8')
}

/**
 * 更新 index.md（追加/更新页面条目）。
 * @param content - 完整的 index.md 内容
 */
export async function updateIndex(content: string): Promise<void> {
  const wikiPath = getWikiPath()
  await writeFile(join(wikiPath, SPECIAL_FILES.INDEX), content, 'utf-8')
}

/**
 * 自动生成 index.md 内容（基于 wiki/ 目录当前状态）。
 */
export async function regenerateIndex(): Promise<string> {
  const pages = await listWikiPages()

  const lines: string[] = [
    '# 🌐 LLM Wiki Index',
    '',
    '> 自动维护的知识库目录 — 每次编译后更新',
    `> 共 ${pages.length} 个页面 | 最后更新: ${new Date().toISOString().slice(0, 10)}`,
    '',
    '---',
    '',
  ]

  // 按类别分组
  const categories = new Map<string, WikiPageInfo[]>()
  for (const page of pages) {
    const cat = page.category || 'uncategorized'
    if (!categories.has(cat)) categories.set(cat, [])
    categories.get(cat)!.push(page)
  }

  for (const [cat, catPages] of categories) {
    lines.push(`## ${cat === 'root' ? '📄 页面' : `📁 ${cat}`}`)
    lines.push('')
    for (const page of catPages) {
      const linkPath = page.path.replace(/\.md$/, '')
      lines.push(`- [${page.title}](wiki/${linkPath}) — ${page.summary || '*(无摘要)*'}`)
    }
    lines.push('')
  }

  lines.push('---')
  lines.push('')
  lines.push(`> 自动生成于 ${new Date().toISOString()}`)

  return lines.join('\n')
}

// ─── Log 管理 ──────────────────────────────────────────────────

/**
 * 追加一条日志条目到 log.md。
 * @param entryType - 日志类型（ingest | query | lint）
 * @param description - 描述
 */
export async function appendLog(entryType: string, description: string): Promise<void> {
  const wikiPath = getWikiPath()
  const logPath = join(wikiPath, SPECIAL_FILES.LOG)

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const entry = `## [${timestamp}] ${entryType}\n${description}\n\n`

  if (!existsSync(logPath)) {
    await writeFile(logPath, getDefaultLog() + entry, 'utf-8')
  } else {
    // 注意：必须使用 appendFile 追加写入；writeFile 会整文件覆盖丢失历史
    await appendFile(logPath, entry, 'utf-8')
  }
}

/**
 * 读取最近的日志条目。
 * @param limit - 返回条数
 */
export async function readRecentLogs(limit: number = 10): Promise<string> {
  const wikiPath = getWikiPath()
  const logPath = join(wikiPath, SPECIAL_FILES.LOG)

  if (!existsSync(logPath)) return '（暂无日志）'

  const content = await readFile(logPath, 'utf-8')
  const entries = content.split('\n## [')
  const recent = entries.slice(-limit - 1)
  return recent.join('\n## [')
}

// ─── 统计 ──────────────────────────────────────────────────────

/**
 * 获取 Wiki 统计信息。
 */
export async function getWikiStats(): Promise<WikiStats> {
  const wikiPath = getWikiPath()

  const rawSources = await listRawSources()
  const wikiPages = await listWikiPages()

  const logContent = existsSync(join(wikiPath, 'log.md'))
    ? await readFile(join(wikiPath, 'log.md'), 'utf-8')
    : ''

  // 提取最后 ingest 和 lint 时间
  const ingestMatches = logContent.matchAll(/## \[([^\]]+)\] ingest/g)
  const lintMatches = logContent.matchAll(/## \[([^\]]+)\] lint/g)

  const lastIngest = [...ingestMatches].pop()?.[1] ?? null
  const lastLint = [...lintMatches].pop()?.[1] ?? null

  // 计算 wiki 总大小（实际文件字节数）
  let totalSize = 0
  for (const page of wikiPages) {
    try {
      const s = await stat(join(wikiPath, 'wiki', page.path))
      totalSize += s.size
    } catch {
      // 文件可能在统计过程中被删除，跳过
    }
  }

  return {
    rawCount: rawSources.length,
    wikiPageCount: wikiPages.length,
    lastIngest,
    lastLint,
    totalWikiSize: totalSize,
  }
}

// ─── Schema 生成 ───────────────────────────────────────────────

/**
 * 获取默认的 AGENTS.md Schema 文件内容。
 * 这定义了 LLM 维护 Wiki 的规则和行为规范。
 */
function getDefaultSchema(): string {
  return `# LLM Wiki Schema — 知识库维护规则

你是这个 Wiki 的知识管理员。你的职责是维护 .llm-wiki/ 下的三层知识结构。

## 目录结构

- \`raw/\` — 原始资料（不可变）。你只能读取，绝不能修改。
- \`wiki/\` — 编译后的知识页面。你完全拥有此目录的读写权限。
- \`rules/\` — 规则与标准定义。你可以在此存放知识组织标准。
- \`index.md\` — 内容目录。每次 ingest 后必须更新。
- \`log.md\` — 活动日志。每次操作后必须追加记录。

## 页面类型

在 wiki/ 中，你需要维护以下类型的页面：

1. **实体页面** — 人物、公司、工具、项目等具体实体
2. **概念页面** — 想法、框架、定义、理论等抽象概念
3. **源摘要** — 每个 raw/ 资料的摘要页面
4. **对比页** — 多个实体/概念之间的对比分析
5. **综合页** — 跨源的主题综述与演进脉络

## 页面格式规范

每个页面必须包含：

\`\`\`markdown
# 页面标题

**类别**: [实体 | 概念 | 源摘要 | 对比 | 综合]
**标签**: \`tag1\`, \`tag2\`
**相关页面**: [[相关页面1]], [[相关页面2]]

## 概述

<!-- 2-3 句话的核心定义 -->

## 详细内容

<!-- 结构化内容，按需使用子标题 -->

## 来源

- [来源标题](raw/来源文件.md)

## 反向链接

<!-- 自动维护：哪些页面链接到此页面 -->
\`\`\`

## 编译规则

1. **新增资料**：读取 raw/ 中的新文件，提取关键信息，创建或更新相关页面
2. **交叉引用**：实体间使用 [[双向链接]] 语法
3. **矛盾标注**：当新信息与已有内容冲突时，用 \`> [!warning]\` 标注
4. **索引更新**：每次 ingest 完成页面创建/更新后，必须调用 \`wiki_ingest action=regenerate_index\`（后端会自动写入 index.md，无需手动 file_write）
5. **日志记录**：日志由系统自动追加到 log.md（ingest/regenerate_index 时），不要手动写 log.md，也不要在 wiki/ 目录下创建 log.md

## 查询规则

当用户提问时：
1. 先读取 index.md 了解全貌
2. 读取相关页面获取详细信息
3. 如有需要，查看 raw/ 中的原始资料
4. 综合回答，附带 [[页面链接]] 引用

## 健康检查（lint）

定期检查：
1. 页面间的矛盾信息
2. 被新资料推翻的陈旧说法
3. 没有任何入链的孤立页面
4. 被提及但缺少独立页面的重要概念
5. 缺失的交叉引用
6. 可通过网络搜索填补的信息空白
`
}

function getDefaultIndex(): string {
  return '# 🌐 LLM Wiki Index\n\n> 知识库目录 — 开始使用后自动填充\n\n---\n\n📄 **Wiki 目前为空**。\n\n请使用 \`wiki-ingest\` 工具添加原始资料开始编译知识库。\n'
}

function getDefaultLog(): string {
  return '# 📋 LLM Wiki Activity Log\n\n> 所有 Ingest / Query / Lint 操作的时序记录\n\n---\n\n'
}

// ─── 文本辅助函数 ─────────────────────────────────────────────

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)/m)
  return match ? match[1].trim() : ''
}

function extractSummary(content: string): string {
  // 查找概述部分的前 2-3 句话
  const overviewMatch = content.match(/##\s*概述\s*\n\n([^#]+)/)
  if (overviewMatch) {
    const text = overviewMatch[1].trim()
    return text.split(/[。！？\n]/).slice(0, 2).join('').slice(0, 100) + (text.length > 100 ? '...' : '')
  }

  // 回退：取第一段非空文本
  const lines = content.split('\n').filter((l) => l.trim() && !l.startsWith('#'))
  return lines[0]?.slice(0, 100) || ''
}