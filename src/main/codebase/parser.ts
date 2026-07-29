// AgentForge CB: 代码解析器
// 语言检测 + 符号提取 + 代码分块
// 使用正则表达式模式匹配（非完整 AST，但覆盖大部分实际使用场景）

import type {
  CodebaseLanguage,
  SymbolType,
  SymbolVisibility,
  CodeChunkType,
} from '@shared/types'
import { estimateTokens } from '../agent/tokenizer'
import { AppError, ErrorCodes } from '../utils/error'

// ─── 语言检测 ─────────────────────────────────────────────────

/** 文件扩展名 → 语言映射 */
const EXTENSION_MAP: Record<string, CodebaseLanguage> = {
  // TypeScript / JavaScript
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  // Python
  py: 'python',
  pyw: 'python',
  // Go
  go: 'go',
  // Rust
  rs: 'rust',
  // Java
  java: 'java',
  // C / C++
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  // C#
  cs: 'csharp',
  // Ruby
  rb: 'ruby',
  // PHP
  php: 'php',
  // Swift
  swift: 'swift',
  // Kotlin
  kt: 'kotlin',
  kts: 'kotlin',
  // Scala
  scala: 'scala',
  sc: 'scala',
  // CSS / SCSS
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  // HTML
  html: 'html',
  htm: 'html',
  // Vue / Svelte
  vue: 'vue',
  svelte: 'svelte',
  // Data formats
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  // Markdown
  md: 'markdown',
  mdx: 'markdown',
  // SQL
  sql: 'sql',
  // Shell
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  // Dockerfile
  dockerfile: 'dockerfile',
}

/** Dockerfile 特殊文件名 */
const DOCKERFILE_NAMES = new Set(['dockerfile', 'dockerfile.dev', 'dockerfile.prod'])

/**
 * 根据文件名检测编程语言。
 * 先检查特殊文件名（如 Dockerfile），再按扩展名匹配。
 */
export function detectLanguage(fileName: string): CodebaseLanguage {
  const lowerName = fileName.toLowerCase()

  // Dockerfile 特殊处理
  if (DOCKERFILE_NAMES.has(lowerName)) {
    return 'dockerfile'
  }

  const lastDot = lowerName.lastIndexOf('.')
  if (lastDot === -1) {
    return 'unknown'
  }

  const ext = lowerName.slice(lastDot + 1)
  return EXTENSION_MAP[ext] ?? 'unknown'
}

/**
 * 获取语言对应的文件扩展名列表（用于目录扫描）。
 */
export function getExtensionsForLanguage(lang: CodebaseLanguage): string[] {
  const result: string[] = []
  for (const [ext, l] of Object.entries(EXTENSION_MAP)) {
    if (l === lang) {
      result.push(`.${ext}`)
    }
  }
  return result
}

/**
 * 获取所有支持的代码文件扩展名。
 */
export function getSupportedCodeExtensions(): string[] {
  return Object.keys(EXTENSION_MAP).map((ext) => `.${ext}`)
}

// ─── 符号提取 ─────────────────────────────────────────────────

/** 提取的符号信息 */
export interface ExtractedSymbol {
  name: string
  qualifiedName: string
  symbolType: SymbolType
  visibility: SymbolVisibility
  signature: string
  startLine: number
  endLine: number
  docComment?: string
}

/** 提取的代码分块信息 */
export interface ExtractedChunk {
  content: string
  chunkType: CodeChunkType
  symbolId?: string
  startLine: number
  endLine: number
  tokenCount: number
  chunkIndex: number
}

/** 解析结果 */
export interface ParseResult {
  language: CodebaseLanguage
  symbols: ExtractedSymbol[]
  chunks: ExtractedChunk[]
  lineCount: number
}

/**
 * 解析代码文件，提取符号和分块。
 * 根据语言选择对应的解析策略。
 *
 * @param content - 文件内容
 * @param fileName - 文件名（用于语言检测）
 * @returns 解析结果
 * @throws {AppError} CB_PARSE_ERROR - 解析失败
 */
export function parseCodeFile(content: string, fileName: string): ParseResult {
  const language = detectLanguage(fileName)
  const lines = content.split('\n')
  const lineCount = lines.length

  try {
    if (isBraceLanguage(language)) {
      return parseBraceLanguage(content, lines, language)
    }

    if (language === 'python') {
      return parsePython(content, lines)
    }

    if (language === 'ruby') {
      return parseRuby(content, lines)
    }

    // 回退：简单的固定大小分块
    return parseGeneric(content, lines, language)
  } catch (error) {
    if (error instanceof AppError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new AppError(
      ErrorCodes.CB_PARSE_ERROR,
      `Failed to parse file "${fileName}": ${message}`,
      { fileName, language },
    )
  }
}

// ─── 花括号语言解析（TS/JS/Java/C/C++/Go/Rust/C#等） ──────────

function isBraceLanguage(lang: CodebaseLanguage): boolean {
  return [
    'typescript', 'javascript', 'java', 'c', 'cpp', 'csharp',
    'go', 'rust', 'kotlin', 'scala', 'swift', 'php',
  ].includes(lang)
}

/**
 * 花括号语言的符号模式定义。
 * 每个模式包含：正则表达式、符号类型、名称捕获组索引、可见性提取函数。
 */
interface SymbolPattern {
  regex: RegExp
  type: SymbolType
  /** 名称所在的捕获组索引（从 1 开始） */
  nameGroup: number
  extractVisibility?: (match: RegExpMatchArray) => SymbolVisibility
}

/** 获取花括号语言的符号匹配模式 */
function getBraceLanguagePatterns(lang: CodebaseLanguage): SymbolPattern[] {
  const patterns: SymbolPattern[] = []

  // 函数/方法：function name(...) {
  patterns.push({
    regex: /^(export\s+)?(default\s+)?(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(<[^>]*>)?\s*\([^)]*\)/,
    type: 'function',
    nameGroup: 4,
    extractVisibility: (m) => (m[1] ? 'public' : 'default'),
  })

  // 箭头函数/变量赋值函数：const name = (...) => {
  patterns.push({
    regex: /^(export\s+)?(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(async\s*)?\([^)]*\)\s*=>/,
    type: 'function',
    nameGroup: 3,
    extractVisibility: (m) => (m[1] ? 'public' : 'default'),
  })

  // Go: func name(...) { 或 func (recv) name(...) {
  if (lang === 'go') {
    patterns.push({
      regex: /^func\s+(?:\([^)]*\)\s+)?([A-Za-z_]\w*)\s*\([^)]*\)/,
      type: 'function',
      nameGroup: 1,
    })
  }

  // Rust: fn name(...) {
  if (lang === 'rust') {
    patterns.push({
      regex: /^(pub\s+)?(async\s+)?(unsafe\s+)?fn\s+([A-Za-z_]\w*)\s*(<[^>]*>)?\s*\(/,
      type: 'function',
      nameGroup: 4,
      extractVisibility: (m) => (m[1] ? 'public' : 'default'),
    })
    // Rust: struct / enum / trait
    patterns.push({
      regex: /^(pub\s+)?struct\s+([A-Za-z_]\w*)/,
      type: 'class',
      nameGroup: 2,
      extractVisibility: (m) => (m[1] ? 'public' : 'default'),
    })
    patterns.push({
      regex: /^(pub\s+)?enum\s+([A-Za-z_]\w*)/,
      type: 'enum',
      nameGroup: 2,
      extractVisibility: (m) => (m[1] ? 'public' : 'default'),
    })
    patterns.push({
      regex: /^(pub\s+)?trait\s+([A-Za-z_]\w*)/,
      type: 'interface',
      nameGroup: 2,
      extractVisibility: (m) => (m[1] ? 'public' : 'default'),
    })
  }

  // 类
  patterns.push({
    regex: /^(export\s+)?(abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    type: 'class',
    nameGroup: 3,
    extractVisibility: (m) => (m[1] ? 'public' : 'default'),
  })

  // 接口
  patterns.push({
    regex: /^(export\s+)?interface\s+([A-Za-z_$][\w$]*)/,
    type: 'interface',
    nameGroup: 2,
    extractVisibility: (m) => (m[1] ? 'public' : 'default'),
  })

  // 类型别名（包括 Go struct/enum/interface）
  patterns.push({
    regex: /^(export\s+)?type\s+([A-Za-z_$][\w$]*)(?:\s*=|\s+struct|\s+enum|\s+interface|\s+\{)/,
    type: 'type',
    nameGroup: 2,
    extractVisibility: (m) => (m[1] ? 'public' : 'default'),
  })

  // 枚举
  patterns.push({
    regex: /^(export\s+)?enum\s+([A-Za-z_$][\w$]*)/,
    type: 'enum',
    nameGroup: 2,
    extractVisibility: (m) => (m[1] ? 'public' : 'default'),
  })

  // 常量导出
  patterns.push({
    regex: /^export\s+const\s+([A-Z][A-Z0-9_]*)/,
    type: 'constant',
    nameGroup: 1,
    extractVisibility: () => 'public',
  })

  return patterns
}

/**
 * 解析花括号语言（TS/JS/Java/C/Go/Rust 等）。
 * 使用正则提取符号定义，然后通过花括号配对确定符号范围。
 */
function parseBraceLanguage(
  _content: string,
  lines: string[],
  language: CodebaseLanguage,
): ParseResult {
  const patterns = getBraceLanguagePatterns(language)
  const symbols: ExtractedSymbol[] = []

  // 扫描每一行，匹配符号定义
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // 跳过空行和纯注释行
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*')) {
      continue
    }

    for (const pattern of patterns) {
      const match = line.match(pattern.regex)
      if (!match) continue

      // 使用 pattern.nameGroup 指定的捕获组提取符号名
      const name = match[pattern.nameGroup]
      if (!name) continue

      const visibility = pattern.extractVisibility?.(match) ?? 'default'
      const signature = trimmed

      // 查找符号结束位置（花括号配对）
      const { endLine, docComment } = findBraceBlockEnd(lines, i)

      // 如果找不到结束花括号，至少标记下一行
      const actualEndLine = endLine > i ? endLine : Math.min(i + 1, lines.length - 1)

      symbols.push({
        name,
        qualifiedName: name,
        symbolType: pattern.type,
        visibility,
        signature,
        startLine: i + 1, // 1-indexed
        endLine: actualEndLine + 1,
        docComment: docComment ?? undefined,
      })

      break // 一行只匹配一个符号
    }
  }

  // 基于符号生成代码分块
  const chunks = createChunksFromSymbols(lines, symbols)

  return {
    language,
    symbols,
    chunks,
    lineCount: lines.length,
  }
}

/**
 * 从指定行开始，查找花括号块的结束位置。
 * 同时提取前导文档注释（/** 或 // ）。
 */
function findBraceBlockEnd(
  lines: string[],
  startIdx: number,
): { endLine: number; docComment?: string } {
  // 查找前导文档注释
  const docComment = extractDocComment(lines, startIdx)

  // 查找第一个 {
  let braceIdx = startIdx
  let foundOpenBrace = false

  for (let i = startIdx; i < Math.min(startIdx + 5, lines.length); i++) {
    const line = lines[i]
    // 跳过在同一行的情况（如 `function foo() {`）
    if (line.includes('{')) {
      braceIdx = i
      foundOpenBrace = true
      break
    }
    // 可能是单行声明，如 `type Foo = string`
    if (i > startIdx && line.trim() !== '' && !line.trim().startsWith('//')) {
      // 如果不是花括号块，结束行就是当前行
      if (!line.includes('{')) {
        return { endLine: i, docComment }
      }
    }
  }

  if (!foundOpenBrace) {
    // 没有花括号，可能是单行声明
    return { endLine: startIdx, docComment }
  }

  // 花括号配对
  let depth = 0
  for (let i = braceIdx; i < lines.length; i++) {
    const line = lines[i]
    for (const ch of line) {
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          return { endLine: i, docComment }
        }
      }
    }
  }

  // 未闭合的花括号，返回文件末尾
  return { endLine: lines.length - 1, docComment }
}

/**
 * 提取前导文档注释（/** ... *\/ 或 // 注释）。
 */
function extractDocComment(lines: string[], defLineIdx: number): string | undefined {
  // 向上查找 JSDoc 风格注释
  let commentEnd = defLineIdx - 1

  // 跳过空行
  while (commentEnd >= 0 && lines[commentEnd].trim() === '') {
    commentEnd--
  }

  if (commentEnd < 0) return undefined

  // 检查是否是 */ 结尾的块注释
  if (lines[commentEnd].trim().endsWith('*/')) {
    let commentStart = commentEnd
    while (commentStart >= 0 && !lines[commentStart].includes('/**') && !lines[commentStart].includes('/*')) {
      commentStart--
    }
    if (commentStart >= 0 && lines[commentStart].includes('/**')) {
      const commentLines = lines.slice(commentStart, commentEnd + 1)
      return commentLines.join('\n')
    }
  }

  // 检查是否是 // 单行注释
  if (lines[commentEnd].trim().startsWith('//')) {
    let commentStart = commentEnd
    while (commentStart > 0 && lines[commentStart - 1].trim().startsWith('//')) {
      commentStart--
    }
    const commentLines = lines.slice(commentStart, commentEnd + 1)
    return commentLines.join('\n')
  }

  return undefined
}

// ─── Python 解析 ──────────────────────────────────────────────

/**
 * 解析 Python 代码。
 * 使用缩进级别确定函数/类的范围。
 */
function parsePython(content: string, lines: string[]): ParseResult {
  const symbols: ExtractedSymbol[] = []

  // 函数定义：def name(...):
  const funcPattern = /^(\s*)(async\s+)?def\s+([A-Za-z_]\w*)\s*\([^)]*\)/
  // 类定义：class name(...):
  const classPattern = /^(\s*)class\s+([A-Za-z_]\w*)\s*(\([^)]*\))?:/
  // 装饰器：@decorator
  const decoratorPattern = /^(\s*)@([A-Za-z_][\w.]*)/

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed === '' || trimmed.startsWith('#')) continue

    // 函数定义
    const funcMatch = line.match(funcPattern)
    if (funcMatch) {
      const indent = funcMatch[1].length
      const name = funcMatch[3]
      const isAsync = !!funcMatch[2]
      const visibility: SymbolVisibility = name.startsWith('_') ? 'private' : 'public'

      const endLine = findPythonBlockEnd(lines, i, indent)
      const docComment = extractPythonDocstring(lines, i)

      symbols.push({
        name,
        qualifiedName: name,
        symbolType: indent === 0 ? 'function' : 'method',
        visibility,
        signature: `${isAsync ? 'async ' : ''}def ${name}(...)`,
        startLine: i + 1,
        endLine: endLine + 1,
        docComment: docComment ?? undefined,
      })
      continue
    }

    // 类定义
    const classMatch = line.match(classPattern)
    if (classMatch) {
      const indent = classMatch[1].length
      const name = classMatch[2]
      const baseClass = classMatch[3] ?? ''
      const endLine = findPythonBlockEnd(lines, i, indent)
      const docComment = extractPythonDocstring(lines, i)

      symbols.push({
        name,
        qualifiedName: name,
        symbolType: 'class',
        visibility: 'public',
        signature: `class ${name}${baseClass}`,
        startLine: i + 1,
        endLine: endLine + 1,
        docComment: docComment ?? undefined,
      })
    }
  }

  const chunks = createChunksFromSymbols(lines, symbols)

  return {
    language: 'python',
    symbols,
    chunks,
    lineCount: lines.length,
  }
}

/**
 * 查找 Python 代码块的结束行（基于缩进）。
 */
function findPythonBlockEnd(lines: string[], defLine: number, defIndent: number): number {
  // 函数体从 def 行的下一行开始
  // 找到第一个缩进大于 defIndent 的行，然后找缩进回到 <= defIndent 的位置
  let bodyStart = defLine + 1

  // 跳过空行
  while (bodyStart < lines.length && lines[bodyStart].trim() === '') {
    bodyStart++
  }

  if (bodyStart >= lines.length) {
    return lines.length - 1
  }

  const bodyIndent = getIndentLevel(lines[bodyStart])
  if (bodyIndent <= defIndent) {
    // 没有函数体（可能是抽象方法或 pass）
    return defLine
  }

  // 向下扫描，直到缩进回到 <= defIndent
  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue

    const indent = getIndentLevel(line)
    if (indent <= defIndent && !line.trim().startsWith('#')) {
      return i - 1
    }
  }

  return lines.length - 1
}

/** 获取行的缩进级别（空格数） */
function getIndentLevel(line: string): number {
  let count = 0
  for (const ch of line) {
    if (ch === ' ') count++
    else if (ch === '\t') count += 4
    else break
  }
  return count
}

/** 提取 Python docstring（""" 或 ''' 包围的字符串） */
function extractPythonDocstring(lines: string[], defLine: number): string | undefined {
  const bodyStart = defLine + 1
  if (bodyStart >= lines.length) return undefined

  const line = lines[bodyStart].trim()
  if (line.startsWith('"""') || line.startsWith("'''")) {
    const delim = line.slice(0, 3)
    // 单行 docstring
    if (line.endsWith(delim) && line.length > 3) {
      return line
    }
    // 多行 docstring
    let end = bodyStart + 1
    while (end < lines.length) {
      if (lines[end].includes(delim)) {
        return lines.slice(bodyStart, end + 1).join('\n')
      }
      end++
    }
  }

  return undefined
}

// ─── Ruby 解析 ────────────────────────────────────────────────

/**
 * 解析 Ruby 代码。
 * 使用 end 关键字确定块范围。
 */
function parseRuby(content: string, lines: string[]): ParseResult {
  const symbols: ExtractedSymbol[] = []

  const funcPattern = /^\s*(private\s+|protected\s+|public\s+)?def\s+([A-Za-z_]\w*)([\s.][A-Za-z_]\w*)?/
  const classPattern = /^\s*class\s+([A-Za-z_]\w*)/
  const modulePattern = /^\s*module\s+([A-Za-z_]\w*)/

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed === '' || trimmed.startsWith('#')) continue

    const funcMatch = line.match(funcPattern)
    if (funcMatch) {
      const visibilityMod = funcMatch[1]?.trim()
      const name = funcMatch[2]
      const visibility: SymbolVisibility = visibilityMod === 'private' ? 'private' :
        visibilityMod === 'protected' ? 'protected' : 'public'
      const endLine = findRubyBlockEnd(lines, i)

      symbols.push({
        name,
        qualifiedName: name,
        symbolType: 'method',
        visibility,
        signature: trimmed,
        startLine: i + 1,
        endLine: endLine + 1,
      })
      continue
    }

    const classMatch = line.match(classPattern)
    if (classMatch) {
      const name = classMatch[1]
      const endLine = findRubyBlockEnd(lines, i)

      symbols.push({
        name,
        qualifiedName: name,
        symbolType: 'class',
        visibility: 'public',
        signature: trimmed,
        startLine: i + 1,
        endLine: endLine + 1,
      })
      continue
    }

    const moduleMatch = line.match(modulePattern)
    if (moduleMatch) {
      const name = moduleMatch[1]
      const endLine = findRubyBlockEnd(lines, i)

      symbols.push({
        name,
        qualifiedName: name,
        symbolType: 'class', // Ruby module maps to class type
        visibility: 'public',
        signature: trimmed,
        startLine: i + 1,
        endLine: endLine + 1,
      })
    }
  }

  const chunks = createChunksFromSymbols(lines, symbols)

  return {
    language: 'ruby',
    symbols,
    chunks,
    lineCount: lines.length,
  }
}

/** 查找 Ruby 块的结束（匹配 end 关键字） */
function findRubyBlockEnd(lines: string[], startIdx: number): number {
  let depth = 1 // 起始的 def/class/module 已经开启了 depth=1

  for (let i = startIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // 增加深度的关键字
    if (/^(def|class|module|begin|case|if|unless|while|until|for|loop)\b/.test(trimmed) ||
        /\bdo\s*(\|[^|]*\|)?$/.test(trimmed)) {
      depth++
    }

    // 减少深度
    if (trimmed === 'end' || trimmed.startsWith('end ')) {
      depth--
      if (depth === 0) {
        return i
      }
    }
  }

  return lines.length - 1
}

// ─── 通用解析（回退策略） ──────────────────────────────────────

/**
 * 通用解析：按固定行数分块，不提取符号。
 * 适用于 CSS、HTML、JSON、Markdown 等非编程语言文件。
 */
function parseGeneric(content: string, lines: string[], language: CodebaseLanguage): ParseResult {
  const CHUNK_SIZE = 60 // 行数
  const chunks: ExtractedChunk[] = []

  let chunkIndex = 0
  let startLine = 0

  while (startLine < lines.length) {
    const endLine = Math.min(startLine + CHUNK_SIZE - 1, lines.length - 1)
    const chunkContent = lines.slice(startLine, endLine + 1).join('\n')
    const tokenCount = estimateTokens(chunkContent)

    if (tokenCount > 0) {
      chunks.push({
        content: chunkContent,
        chunkType: 'module',
        startLine: startLine + 1,
        endLine: endLine + 1,
        tokenCount,
        chunkIndex: chunkIndex++,
      })
    }

    startLine = endLine + 1
  }

  return {
    language,
    symbols: [],
    chunks,
    lineCount: lines.length,
  }
}

// ─── 从符号生成代码分块 ───────────────────────────────────────

/**
 * 基于提取的符号生成代码分块。
 * 每个符号对应一个分块，符号之间的间隙也作为独立分块。
 * 大符号（超过 MAX_CHUNK_LINES）会被进一步切分。
 */
const MAX_CHUNK_LINES = 200
const MAX_CHUNK_TOKENS = 800

function createChunksFromSymbols(
  lines: string[],
  symbols: ExtractedSymbol[],
): ExtractedChunk[] {
  const chunks: ExtractedChunk[] = []
  let chunkIndex = 0

  // 按起始行排序
  const sorted = [...symbols].sort((a, b) => a.startLine - b.startLine)

  let currentLine = 0 // 0-indexed

  for (const sym of sorted) {
    const symStartIdx = sym.startLine - 1 // 转 0-indexed

    // 符号前的间隙作为独立分块
    if (symStartIdx > currentLine) {
      const gapContent = lines.slice(currentLine, symStartIdx).join('\n')
      const gapTokens = estimateTokens(gapContent)

      if (gapTokens > 10) {
        chunks.push({
          content: gapContent,
          chunkType: 'module',
          startLine: currentLine + 1,
          endLine: symStartIdx,
          tokenCount: gapTokens,
          chunkIndex: chunkIndex++,
        })
      }
    }

    // 符号本身作为分块
    const symEndIdx = sym.endLine - 1 // 转 0-indexed
    const symContent = lines.slice(symStartIdx, symEndIdx + 1).join('\n')
    const symTokens = estimateTokens(symContent)

    if (symTokens === 0) {
      currentLine = symEndIdx + 1
      continue
    }

    // 大符号需要进一步切分
    if (symEndIdx - symStartIdx + 1 > MAX_CHUNK_LINES || symTokens > MAX_CHUNK_TOKENS) {
      const subChunks = splitLargeChunk(lines, symStartIdx, symEndIdx, sym.symbolType)
      for (const sc of subChunks) {
        chunks.push({
          content: sc.content,
          chunkType: sym.symbolType === 'class' ? 'class' : 'function',
          symbolId: undefined, // 在 scanner 中设置
          startLine: sc.startLine,
          endLine: sc.endLine,
          tokenCount: sc.tokenCount,
          chunkIndex: chunkIndex++,
        })
      }
    } else {
      chunks.push({
        content: symContent,
        chunkType: sym.symbolType === 'class' ? 'class' : sym.symbolType === 'function' || sym.symbolType === 'method' ? 'function' : 'block',
        symbolId: undefined,
        startLine: sym.startLine,
        endLine: sym.endLine,
        tokenCount: symTokens,
        chunkIndex: chunkIndex++,
      })
    }

    currentLine = symEndIdx + 1
  }

  // 文件末尾的剩余内容
  if (currentLine < lines.length) {
    const tailContent = lines.slice(currentLine).join('\n')
    const tailTokens = estimateTokens(tailContent)

    if (tailTokens > 10) {
      chunks.push({
        content: tailContent,
        chunkType: 'module',
        startLine: currentLine + 1,
        endLine: lines.length,
        tokenCount: tailTokens,
        chunkIndex: chunkIndex++,
      })
    }
  }

  return chunks
}

/** 切分过大的符号块 */
function splitLargeChunk(
  lines: string[],
  startIdx: number,
  endIdx: number,
  symbolType: SymbolType,
): Array<{ content: string; startLine: number; endLine: number; tokenCount: number }> {
  const result: Array<{ content: string; startLine: number; endLine: number; tokenCount: number }> = []
  let current = startIdx

  while (current <= endIdx) {
    let end = Math.min(current + MAX_CHUNK_LINES - 1, endIdx)

    // 尝试在空行处切分
    if (end < endIdx) {
      for (let i = end; i > current; i--) {
        if (lines[i].trim() === '') {
          end = i
          break
        }
      }
    }

    const content = lines.slice(current, end + 1).join('\n')
    const tokens = estimateTokens(content)

    if (tokens > 0) {
      result.push({
        content,
        startLine: current + 1,
        endLine: end + 1,
        tokenCount: tokens,
      })
    }

    current = end + 1
  }

  return result
}

// ─── 导出辅助函数 ─────────────────────────────────────────────

/**
 * 判断语言是否为"代码"语言（需要符号提取）。
 * 非代码语言（如 JSON、YAML、Markdown）使用简单分块。
 */
export function isCodeLanguage(lang: CodebaseLanguage): boolean {
  return ![
    'json', 'yaml', 'toml', 'markdown', 'sql', 'shell', 'dockerfile', 'unknown',
  ].includes(lang)
}

/**
 * 获取语言的可读名称。
 */
export function getLanguageDisplayName(lang: CodebaseLanguage): string {
  const names: Partial<Record<CodebaseLanguage, string>> = {
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    python: 'Python',
    go: 'Go',
    rust: 'Rust',
    java: 'Java',
    c: 'C',
    cpp: 'C++',
    csharp: 'C#',
    ruby: 'Ruby',
    php: 'PHP',
    swift: 'Swift',
    kotlin: 'Kotlin',
    scala: 'Scala',
    css: 'CSS',
    scss: 'SCSS',
    html: 'HTML',
    vue: 'Vue',
    svelte: 'Svelte',
    json: 'JSON',
    yaml: 'YAML',
    toml: 'TOML',
    markdown: 'Markdown',
    sql: 'SQL',
    shell: 'Shell',
    dockerfile: 'Dockerfile',
    unknown: 'Unknown',
  }
  return names[lang] ?? lang
}
