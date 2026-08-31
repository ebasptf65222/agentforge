// AgentForge 视频 CSV 批量造片解析（M11）
//
// 职责：将本地 CSV 文本解析并校验为多行 CreateVideoTaskParams，
// 供批量生成（VideoEngine.generateRows）复用受限并发提交。
//
// CSV 约定：
// - UTF-8，兼容 BOM（自动剥离）
// - 表头必需含 `prompt` 列；可选 `duration` / `resolution` / `aspect`
// - 空行忽略；非法行记录到 skipped，不阻断其他行
// - 遵循 RFC 4180 基础规则：逗号分隔、引号包裹的字段可含逗号/内嵌换行、双引号转义

import type { CreateVideoTaskParams, VideoAspect, VideoResolution } from '@shared/types'

/** 受支持的枚举（镜像 shared/types 定义） */
const RESOLUTIONS: VideoResolution[] = ['480P', '720P', '1080P']
const ASPECTS: VideoAspect[] = ['16:9', '9:16', '4:3', '3:4', '1:1']

/** 被跳过的一行（不阻断整体解析） */
export interface CsvSkippedRow {
  /** 原文件行号（1-based，含表头行） */
  line: number
  reason: string
}

/** CSV 解析与校验的结果 */
export interface CsvParseResult {
  /** 可提交生成的任务行 */
  rows: CreateVideoTaskParams[]
  /** 因缺 prompt / 非法参数被跳过的行 */
  skipped: CsvSkippedRow[]
  /** 表头缺失 prompt 列（此时 rows 为空且不再逐行校验） */
  headerMissingPrompt: boolean
}

/**
 * RFC 4180 风格 CSV 分词：返回二维字段数组。
 * 支持引号包裹的字段（内嵌逗号、换行）与双引号转义（"" → "）。
 */
export function tokenizeCsv(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const n = content.length

  while (i < n) {
    const c = content[i]
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') {
          field += '"'
          i += 2
        } else {
          inQuotes = false
          i += 1
        }
      } else {
        field += c
        i += 1
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
      i += 1
    } else if (c === ',') {
      row.push(field)
      field = ''
      i += 1
    } else if (c === '\r') {
      if (content[i + 1] === '\n') i += 1
      row.push(field)
      field = ''
      rows.push(row)
      row = []
      i += 1
    } else if (c === '\n') {
      row.push(field)
      field = ''
      rows.push(row)
      row = []
      i += 1
    } else {
      field += c
      i += 1
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/**
 * 解析并校验 CSV 文本为可生成的任务行。
 *
 * @param content - CSV 文本内容
 */
export function parseCsvRows(content: string): CsvParseResult {
  // 剥离 UTF-8 BOM
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
  const raw = tokenizeCsv(text)
  // 过滤纯空行
  const data = raw.filter((r) => r.some((f) => f.trim() !== ''))

  const result: CsvParseResult = { rows: [], skipped: [], headerMissingPrompt: false }
  if (data.length === 0) return result

  const header = data[0].map((h) => h.trim().toLowerCase())
  const promptIdx = header.indexOf('prompt')
  if (promptIdx < 0) {
    result.headerMissingPrompt = true
    return result
  }
  const durationIdx = header.indexOf('duration')
  const resolutionIdx = header.indexOf('resolution')
  const aspectIdx = header.indexOf('aspect')

  for (let r = 1; r < data.length; r++) {
    const cols = data[r]
    const line = r + 1
    const params: CreateVideoTaskParams = { prompt: '' }

    const promptVal = (cols[promptIdx] ?? '').trim()
    if (!promptVal) {
      result.skipped.push({ line, reason: 'prompt is empty' })
      continue
    }
    params.prompt = promptVal

    if (durationIdx >= 0 && cols[durationIdx] && cols[durationIdx].trim() !== '') {
      const value = Number(cols[durationIdx].trim())
      if (!Number.isFinite(value) || value <= 0) {
        result.skipped.push({ line, reason: 'duration must be a positive number' })
        continue
      }
      params.duration = value
    }

    if (resolutionIdx >= 0 && cols[resolutionIdx] && cols[resolutionIdx].trim() !== '') {
      const value = cols[resolutionIdx].trim().toUpperCase() as VideoResolution
      if (!RESOLUTIONS.includes(value)) {
        result.skipped.push({ line, reason: `unsupported resolution: ${cols[resolutionIdx].trim()}` })
        continue
      }
      params.resolution = value
    }

    if (aspectIdx >= 0 && cols[aspectIdx] && cols[aspectIdx].trim() !== '') {
      const value = cols[aspectIdx].trim() as VideoAspect
      if (!ASPECTS.includes(value)) {
        result.skipped.push({ line, reason: `unsupported aspect: ${cols[aspectIdx].trim()}` })
        continue
      }
      params.aspect = value
    }

    result.rows.push(params)
  }
  return result
}