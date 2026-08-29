// WS-05: workspace store 预览模式逻辑测试
// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'
import { getPreviewMode } from './workspace'

describe('getPreviewMode', () => {
  it('返回 viewer 模式：PDF', () => {
    expect(getPreviewMode('docs/report.pdf', 'report.pdf', 2048)).toBe('viewer')
  })

  it('返回 viewer 模式：Office 文档 (docx/xlsx/pptx)', () => {
    expect(getPreviewMode('a.docx', 'a.docx', 1024)).toBe('viewer')
    expect(getPreviewMode('b.xlsx', 'b.xlsx', 1024)).toBe('viewer')
    expect(getPreviewMode('c.pptx', 'c.pptx', 1024)).toBe('viewer')
  })

  it('返回 viewer 模式：其他办公格式 (ofd/rtf/odt/ods/xls/ppt)', () => {
    expect(getPreviewMode('f.ofd', 'f.ofd', 100)).toBe('viewer')
    expect(getPreviewMode('f.rtf', 'f.rtf', 100)).toBe('viewer')
    expect(getPreviewMode('f.odt', 'f.odt', 100)).toBe('viewer')
    expect(getPreviewMode('f.ods', 'f.ods', 100)).toBe('viewer')
    expect(getPreviewMode('f.xls', 'f.xls', 100)).toBe('viewer')
    expect(getPreviewMode('f.ppt', 'f.ppt', 100)).toBe('viewer')
  })

  it('viewer 模式不因文件大小受限', () => {
    expect(getPreviewMode('big.pdf', 'big.pdf', 100 * 1024 * 1024)).toBe('viewer')
  })

  it('返回 text 模式：代码文件', () => {
    expect(getPreviewMode('src/app.ts', 'app.ts', 1024)).toBe('text')
    expect(getPreviewMode('a.py', 'a.py', 1024)).toBe('text')
    expect(getPreviewMode('README.md', 'README.md', 1024)).toBe('text')
  })

  it('返回 none：非办公、非文本格式', () => {
    expect(getPreviewMode('a.exe', 'a.exe', 1000)).toBe('none')
    expect(getPreviewMode('b.png', 'b.png', 1000)).toBe('none')
  })

  it('扩展名大小写不敏感', () => {
    expect(getPreviewMode('A.PDF', 'A.PDF', 100)).toBe('viewer')
    expect(getPreviewMode('a.Docx', 'a.Docx', 100)).toBe('viewer')
    expect(getPreviewMode('a.TS', 'a.TS', 100)).toBe('text')
  })

  it('无扩展名默认 none', () => {
    expect(getPreviewMode('file', 'file', 100)).toBe('none')
  })
})