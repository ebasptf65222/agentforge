// AgentForge P4-02: 文档解析器
// 支持 markdown、txt、csv 直接解析；pdf/docx/xlsx 需外部工具

import { readFileSync } from 'node:fs'
import type { KbDocument } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'

/** 解析结果 */
export interface ParseResult {
  content: string
  charCount: number
}

/** 支持的文件类型解析器映射 */
const PARSERS: Record<KbDocument['fileType'], (filePath: string) => ParseResult> = {
  markdown: parseTextFile,
  txt: parseTextFile,
  csv: parseTextFile,
  pdf: parsePdfStub,
  docx: parseDocxStub,
  xlsx: parseXlsxStub,
}

/**
 * 解析文本文件（markdown、txt、csv）。
 * - 读取文件内容
 * - 统一换行符为 \n
 * - 去除 BOM
 */
function parseTextFile(filePath: string): ParseResult {
  const raw = readFileSync(filePath, 'utf-8')
  const content = raw
    .replace(/^\uFEFF/, '') // 去除 BOM
    .replace(/\r\n/g, '\n') // 统一换行符
    .replace(/\r/g, '\n')

  return { content, charCount: content.length }
}

/**
 * PDF 解析占位符。
 * PDF 解析需要外部依赖（如 pdf-parse），建议通过 npm install 后接入。
 */
function parsePdfStub(filePath: string): ParseResult {
  throw new AppError(
    ErrorCodes.KB_INDEX_ERROR,
    `PDF parsing requires external dependency. Please install pdf-parse and implement parsePdf(). File: ${filePath}`,
    { fileType: 'pdf', filePath },
  )
}

/**
 * DOCX 解析占位符。
 * DOCX 解析需要外部依赖（如 mammoth），建议通过 npm install 后接入。
 */
function parseDocxStub(filePath: string): ParseResult {
  throw new AppError(
    ErrorCodes.KB_INDEX_ERROR,
    `DOCX parsing requires external dependency. Please install mammoth and implement parseDocx(). File: ${filePath}`,
    { fileType: 'docx', filePath },
  )
}

/**
 * XLSX 解析占位符。
 * XLSX 解析需要外部依赖（如 xlsx），建议通过 npm install 后接入。
 */
function parseXlsxStub(filePath: string): ParseResult {
  throw new AppError(
    ErrorCodes.KB_INDEX_ERROR,
    `XLSX parsing requires external dependency. Please install xlsx and implement parseXlsx(). File: ${filePath}`,
    { fileType: 'xlsx', filePath },
  )
}

/**
 * 解析文档文件，返回纯文本内容。
 *
 * @param filePath - 文件路径
 * @param fileType - 文件类型
 * @returns 解析结果（content + charCount）
 * @throws {AppError} KB_INDEX_ERROR - 解析失败
 */
export function parseDocument(filePath: string, fileType: KbDocument['fileType']): ParseResult {
  const parser = PARSERS[fileType]

  if (parser === undefined) {
    throw new AppError(
      ErrorCodes.KB_INVALID_FILE_TYPE,
      `No parser available for file type "${fileType}".`,
      { filePath, fileType },
    )
  }

  try {
    return parser(filePath)
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(
      ErrorCodes.KB_INDEX_ERROR,
      `Failed to parse document "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
      { filePath, fileType },
    )
  }
}
