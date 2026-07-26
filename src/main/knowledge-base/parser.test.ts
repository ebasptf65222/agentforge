// AgentForge 文档解析器测试
// P5-02: 测试 PDF/DOCX/XLSX 解析器 + 基础文本解析

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ─── Mock 外部解析库 ────────────────────────────────────────────

// Mock unpdf (PDF 解析)
vi.mock('unpdf', () => ({
  extractText: vi.fn().mockResolvedValue({
    text: 'This is mocked PDF text content.\n\nPage 2 content here.',
    totalPages: 2,
  }),
}))

// Mock mammoth (DOCX 解析)
vi.mock('mammoth', () => ({
  default: {
    extractRawText: vi.fn().mockResolvedValue({
      value: 'This is mocked DOCX text content.\n\nSecond paragraph.',
      messages: [],
    }),
  },
}))

// ─── 导入被测模块 ──────────────────────────────────────────────

import { parseDocument } from './parser'
import { AppError, ErrorCodes } from '../utils/error'

// ─── 测试工具 ──────────────────────────────────────────────────

let tempDir: string
let testFilesDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'agentforge-parser-test-'))
  testFilesDir = join(tempDir, 'files')
  mkdirSync(testFilesDir, { recursive: true })
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function createTestFile(fileName: string, content: string): string {
  const filePath = join(testFilesDir, fileName)
  writeFileSync(filePath, content, 'utf-8')
  return filePath
}

// ─── 文本文件解析测试 ───────────────────────────────────────────

describe('parseDocument - text files', () => {
  it('should parse markdown files', async () => {
    const content = '# Title\n\nSome **markdown** content.'
    const filePath = createTestFile('test.md', content)

    const result = await parseDocument(filePath, 'markdown')

    expect(result.content).toBe(content)
    expect(result.charCount).toBe(content.length)
  })

  it('should parse txt files', async () => {
    const content = 'Plain text content\nLine 2'
    const filePath = createTestFile('test.txt', content)

    const result = await parseDocument(filePath, 'txt')

    expect(result.content).toBe(content)
    expect(result.charCount).toBe(content.length)
  })

  it('should parse csv files', async () => {
    const content = 'name,age\nAlice,30\nBob,25'
    const filePath = createTestFile('test.csv', content)

    const result = await parseDocument(filePath, 'csv')

    expect(result.content).toBe(content)
    expect(result.charCount).toBe(content.length)
  })

  it('should remove BOM from text files', async () => {
    const filePath = createTestFile('bom.md', '\uFEFF# Title')

    const result = await parseDocument(filePath, 'markdown')

    expect(result.content).toBe('# Title')
    expect(result.content).not.toContain('\uFEFF')
  })

  it('should normalize line endings to LF', async () => {
    const filePath = createTestFile('crlf.txt', 'Line 1\r\nLine 2\r\nLine 3')

    const result = await parseDocument(filePath, 'txt')

    expect(result.content).toBe('Line 1\nLine 2\nLine 3')
    expect(result.content).not.toContain('\r')
  })

  it('should handle empty files', async () => {
    const filePath = createTestFile('empty.md', '')

    const result = await parseDocument(filePath, 'markdown')

    expect(result.content).toBe('')
    expect(result.charCount).toBe(0)
  })
})

// ─── PDF 解析测试 ───────────────────────────────────────────────

describe('parseDocument - PDF', () => {
  it('should parse PDF files using unpdf', async () => {
    // 创建一个假的 PDF 文件（实际解析被 mock）
    const filePath = createTestFile('test.pdf', 'fake pdf binary content')

    const result = await parseDocument(filePath, 'pdf')

    expect(result.content).toContain('mocked PDF text content')
    expect(result.content).toContain('Page 2 content')
    expect(result.charCount).toBe(result.content.length)
  })

  it('should compress multiple blank lines in PDF output', async () => {
    const filePath = createTestFile('test2.pdf', 'fake pdf')

    const result = await parseDocument(filePath, 'pdf')

    // 连续 3+ 个换行应被压缩为 2 个
    expect(result.content).not.toMatch(/\n{3,}/)
  })

  it('should handle PDF parsing errors', async () => {
    const { extractText } = await import('unpdf')
    vi.mocked(extractText).mockRejectedValue(new Error('PDF parse failed'))

    const filePath = createTestFile('error.pdf', 'invalid pdf')

    try {
      await parseDocument(filePath, 'pdf')
      expect.unreachable('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe(ErrorCodes.KB_INDEX_ERROR)
    }

    // 恢复 mock
    vi.mocked(extractText).mockResolvedValue({
      text: 'This is mocked PDF text content.\n\nPage 2 content here.',
      totalPages: 2,
    })
  })
})

// ─── DOCX 解析测试 ──────────────────────────────────────────────

describe('parseDocument - DOCX', () => {
  it('should parse DOCX files using mammoth', async () => {
    const filePath = createTestFile('test.docx', 'fake docx binary content')

    const result = await parseDocument(filePath, 'docx')

    expect(result.content).toContain('mocked DOCX text content')
    expect(result.content).toContain('Second paragraph')
    expect(result.charCount).toBe(result.content.length)
  })

  it('should compress multiple blank lines in DOCX output', async () => {
    const filePath = createTestFile('test2.docx', 'fake docx')

    const result = await parseDocument(filePath, 'docx')

    expect(result.content).not.toMatch(/\n{3,}/)
  })

  it('should handle DOCX parsing errors', async () => {
    const mammoth = await import('mammoth')
    vi.mocked(mammoth.default.extractRawText).mockRejectedValue(new Error('DOCX parse failed'))

    const filePath = createTestFile('error.docx', 'invalid docx')

    try {
      await parseDocument(filePath, 'docx')
      expect.unreachable('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe(ErrorCodes.KB_INDEX_ERROR)
    }

    // 恢复 mock
    vi.mocked(mammoth.default.extractRawText).mockResolvedValue({
      value: 'This is mocked DOCX text content.\n\nSecond paragraph.',
      messages: [],
    })
  })
})

// ─── XLSX 解析测试 ──────────────────────────────────────────────

describe('parseDocument - XLSX', () => {
  it('should parse real XLSX files with multiple sheets', async () => {
    // 使用 exceljs 创建真实的 XLSX 测试文件
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.default.Workbook()

    const sheet1 = workbook.addWorksheet('Sheet1')
    sheet1.addRow(['Name', 'Age', 'City'])
    sheet1.addRow(['Alice', 30, 'Beijing'])
    sheet1.addRow(['Bob', 25, 'Shanghai'])

    const sheet2 = workbook.addWorksheet('Sheet2')
    sheet2.addRow(['Product', 'Price'])
    sheet2.addRow(['Apple', 5.5])
    sheet2.addRow(['Banana', 3.2])

    const filePath = join(testFilesDir, 'test.xlsx')
    await workbook.xlsx.writeFile(filePath)

    const result = await parseDocument(filePath, 'xlsx')

    // 应包含工作表名称
    expect(result.content).toContain('# Sheet1')
    expect(result.content).toContain('# Sheet2')

    // 应包含数据
    expect(result.content).toContain('Alice')
    expect(result.content).toContain('Beijing')
    expect(result.content).toContain('Apple')
    expect(result.content).toContain('5.5')

    // 列应以制表符分隔
    expect(result.content).toContain('Name\tAge\tCity')

    expect(result.charCount).toBe(result.content.length)
  })

  it('should handle XLSX with empty cells', async () => {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.default.Workbook()
    const sheet = workbook.addWorksheet('Data')
    sheet.addRow(['A', null, 'C'])
    sheet.addRow([null, 'B', null])

    const filePath = join(testFilesDir, 'empty_cells.xlsx')
    await workbook.xlsx.writeFile(filePath)

    const result = await parseDocument(filePath, 'xlsx')

    expect(result.content).toContain('A')
    expect(result.content).toContain('C')
    expect(result.content).toContain('B')
  })

  it('should handle XLSX with numeric values', async () => {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.default.Workbook()
    const sheet = workbook.addWorksheet('Numbers')
    sheet.addRow([1, 2.5, 100])

    const filePath = join(testFilesDir, 'numbers.xlsx')
    await workbook.xlsx.writeFile(filePath)

    const result = await parseDocument(filePath, 'xlsx')

    expect(result.content).toContain('1')
    expect(result.content).toContain('2.5')
    expect(result.content).toContain('100')
  })

  it('should handle invalid XLSX files', async () => {
    const filePath = createTestFile('invalid.xlsx', 'not a real xlsx file')

    await expect(parseDocument(filePath, 'xlsx')).rejects.toThrow(AppError)
    await expect(parseDocument(filePath, 'xlsx')).rejects.toMatchObject({
      code: ErrorCodes.KB_INDEX_ERROR,
    })
  })
})

// ─── 通用错误处理测试 ───────────────────────────────────────────

describe('parseDocument - error handling', () => {
  it('should throw KB_INDEX_ERROR for nonexistent files', async () => {
    const filePath = join(testFilesDir, 'nonexistent.md')

    await expect(parseDocument(filePath, 'markdown')).rejects.toThrow(AppError)
    await expect(parseDocument(filePath, 'markdown')).rejects.toMatchObject({
      code: ErrorCodes.KB_INDEX_ERROR,
    })
  })

  it('should throw KB_INVALID_FILE_TYPE for unknown file types', async () => {
    const filePath = createTestFile('test.unknown', 'content')

    // 使用类型断言绕过 TypeScript 检查
    await expect(parseDocument(filePath, 'unknown' as never)).rejects.toThrow(AppError)
    await expect(parseDocument(filePath, 'unknown' as never)).rejects.toMatchObject({
      code: ErrorCodes.KB_INVALID_FILE_TYPE,
    })
  })
})
