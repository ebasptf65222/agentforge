// AgentForge 文档解析器
// 支持 markdown、txt、csv 直接解析；pdf/docx/xlsx 通过外部库解析
// P4-02: 基础文本解析
// P5-02: 完善 PDF/DOCX/XLSX 二进制格式解析

import { readFileSync } from 'node:fs'
import type { KbDocument } from '@shared/types'
import { AppError, ErrorCodes } from '../utils/error'

/** 解析结果 */
export interface ParseResult {
  content: string
  charCount: number
}

/** 解析器函数类型（异步，支持外部库调用） */
type Parser = (filePath: string) => Promise<ParseResult>

/** 支持的文件类型解析器映射 */
const PARSERS: Record<KbDocument['fileType'], Parser> = {
  markdown: parseTextFile,
  txt: parseTextFile,
  csv: parseTextFile,
  pdf: parsePdf,
  docx: parseDocx,
  xlsx: parseXlsx,
}

/**
 * 解析文本文件（markdown、txt、csv）。
 * - 读取文件内容
 * - 统一换行符为 \n
 * - 去除 BOM
 */
async function parseTextFile(filePath: string): Promise<ParseResult> {
  const raw = readFileSync(filePath, 'utf-8')
  const content = raw
    .replace(/^\uFEFF/, '') // 去除 BOM
    .replace(/\r\n/g, '\n') // 统一换行符
    .replace(/\r/g, '\n')

  return { content, charCount: content.length }
}

/**
 * 解析 PDF 文件，提取纯文本。
 * 使用 unpdf 库（基于 pdfjs-dist），支持多页文本提取。
 */
async function parsePdf(filePath: string): Promise<ParseResult> {
  const { extractText } = await import('unpdf')

  const buffer = new Uint8Array(readFileSync(filePath))
  const { text } = await extractText(buffer, { mergePages: true })

  const content = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n') // 压缩多余空行
    .trim()

  return { content, charCount: content.length }
}

/**
 * 解析 DOCX 文件，提取纯文本。
 * 使用 mammoth 库，将 Word 文档转换为纯文本。
 */
async function parseDocx(filePath: string): Promise<ParseResult> {
  const mammoth = await import('mammoth')
  const result = await mammoth.default.extractRawText({ path: filePath })

  const content = result.value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n') // 压缩多余空行
    .trim()

  return { content, charCount: content.length }
}

/**
 * 解析 XLSX 文件，将所有工作表转换为文本。
 * 使用 exceljs 库，按工作表逐行提取，列以制表符分隔。
 */
async function parseXlsx(filePath: string): Promise<ParseResult> {
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.default.Workbook()
  await workbook.xlsx.readFile(filePath)

  const lines: string[] = []

  workbook.eachSheet((worksheet) => {
    // 添加工作表名称作为标题
    lines.push(`# ${worksheet.name}`)
    lines.push('')

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = []
      // row.values 是稀疏数组，索引 0 为空，从 1 开始
      const maxCol = row.cellCount
      for (let col = 1; col <= maxCol; col++) {
        const cell = row.getCell(col)
        const value = cell.value
        if (value === null || value === undefined) {
          cells.push('')
        } else if (typeof value === 'object') {
          // 处理富文本、超链接等对象类型
          if ('text' in value && typeof value.text === 'string') {
            cells.push(value.text)
          } else if ('result' in value && value.result !== undefined) {
            cells.push(String(value.result))
          } else if ('richText' in value && Array.isArray(value.richText)) {
            cells.push(value.richText.map((rt: { text: string }) => rt.text).join(''))
          } else {
            cells.push(String(value))
          }
        } else {
          cells.push(String(value))
        }
      }
      // 去除尾部空列
      while (cells.length > 0 && cells[cells.length - 1] === '') {
        cells.pop()
      }
      if (cells.length > 0) {
        lines.push(cells.join('\t'))
      }
    })

    lines.push('')
  })

  const content = lines.join('\n').trim()
  return { content, charCount: content.length }
}

/**
 * 解析文档文件，返回纯文本内容。
 * 支持异步解析（PDF/DOCX/XLSX 需要调用外部库）。
 *
 * @param filePath - 文件路径
 * @param fileType - 文件类型
 * @returns 解析结果（content + charCount）
 * @throws {AppError} KB_INDEX_ERROR - 解析失败
 * @throws {AppError} KB_INVALID_FILE_TYPE - 不支持的文件类型
 */
export async function parseDocument(
  filePath: string,
  fileType: KbDocument['fileType'],
): Promise<ParseResult> {
  const parser = PARSERS[fileType]

  if (parser === undefined) {
    throw new AppError(
      ErrorCodes.KB_INVALID_FILE_TYPE,
      `No parser available for file type "${fileType}".`,
      { filePath, fileType },
    )
  }

  try {
    return await parser(filePath)
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(
      ErrorCodes.KB_INDEX_ERROR,
      `Failed to parse document "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
      { filePath, fileType },
    )
  }
}
