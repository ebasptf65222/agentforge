// WS-05: workspace store 预览模式逻辑测试
// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'
import { getPreviewMode, isRenderablePreview } from './workspace'

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

  it('返回 viewer 模式：图片 (png/gif/webp/jpeg)', () => {
    expect(getPreviewMode('img/b.png', 'b.png', 1000)).toBe('viewer')
    expect(getPreviewMode('img/c.gif', 'c.gif', 1000)).toBe('viewer')
    expect(getPreviewMode('img/d.webp', 'd.webp', 1000)).toBe('viewer')
    expect(getPreviewMode('img/e.jpeg', 'e.jpeg', 1000)).toBe('viewer')
  })

  it('返回 viewer 模式：音频视频 (mp3/mp4/webm)', () => {
    expect(getPreviewMode('m/song.mp3', 'song.mp3', 1000)).toBe('viewer')
    expect(getPreviewMode('m/video.mp4', 'video.mp4', 1000)).toBe('viewer')
    expect(getPreviewMode('m/clip.webm', 'clip.webm', 1000)).toBe('viewer')
  })

  it('返回 none：非 viewer、非文本格式', () => {
    expect(getPreviewMode('a.exe', 'a.exe', 1000)).toBe('none')
  })

  it('扩展名大小写不敏感', () => {
    expect(getPreviewMode('A.PDF', 'A.PDF', 100)).toBe('viewer')
    expect(getPreviewMode('a.Docx', 'a.Docx', 100)).toBe('viewer')
    expect(getPreviewMode('a.TS', 'a.TS', 100)).toBe('text')
    expect(getPreviewMode('b.PNG', 'b.PNG', 100)).toBe('viewer')
  })

  it('无扩展名默认 none', () => {
    expect(getPreviewMode('file', 'file', 100)).toBe('none')
  })
})

describe('isRenderablePreview', () => {
  it('md / markdown 可渲染', () => {
    expect(isRenderablePreview('README.md')).toBe(true)
    expect(isRenderablePreview('notes.markdown')).toBe(true)
  })

  it('html / htm 可渲染', () => {
    expect(isRenderablePreview('index.html')).toBe(true)
    expect(isRenderablePreview('page.htm')).toBe(true)
  })

  it('svg 可渲染', () => {
    expect(isRenderablePreview('logo.svg')).toBe(true)
  })

  it('普通代码文件不可渲染', () => {
    expect(isRenderablePreview('app.ts')).toBe(false)
    expect(isRenderablePreview('style.css')).toBe(false)
    expect(isRenderablePreview('b.png')).toBe(false)
    expect(isRenderablePreview('file')).toBe(false)
  })

  it('扩展名大小写不敏感', () => {
    expect(isRenderablePreview('README.MD')).toBe(true)
    expect(isRenderablePreview('Index.HTML')).toBe(true)
  })
})