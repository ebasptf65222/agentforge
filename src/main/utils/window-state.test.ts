import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadWindowState,
  saveWindowState,
  createDebouncedSaver,
  DEFAULT_WINDOW_BOUNDS,
  type WindowBounds,
} from './window-state'

describe('DEFAULT_WINDOW_BOUNDS', () => {
  it('should have 1200x800 dimensions', () => {
    expect(DEFAULT_WINDOW_BOUNDS.width).toBe(1200)
    expect(DEFAULT_WINDOW_BOUNDS.height).toBe(800)
  })

  it('should not be maximized by default', () => {
    expect(DEFAULT_WINDOW_BOUNDS.isMaximized).toBe(false)
  })
})

describe('loadWindowState', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should return null when file does not exist', () => {
    const result = loadWindowState(join(tempDir, 'nonexistent.json'))
    expect(result).toBeNull()
  })

  it('should load valid window state', () => {
    const filePath = join(tempDir, 'window-state.json')
    const bounds: WindowBounds = { x: 100, y: 200, width: 1200, height: 800, isMaximized: true }
    saveWindowState(filePath, bounds)

    const result = loadWindowState(filePath)
    expect(result).toEqual(bounds)
  })

  it('should return null when JSON is corrupted', () => {
    const filePath = join(tempDir, 'corrupt.json')
    writeFileSync(filePath, '{ invalid json !!!', 'utf-8')

    const result = loadWindowState(filePath)
    expect(result).toBeNull()
  })

  it('should return null when width or height is missing', () => {
    const filePath = join(tempDir, 'partial.json')
    writeFileSync(filePath, JSON.stringify({ x: 10, y: 20 }), 'utf-8')

    const result = loadWindowState(filePath)
    expect(result).toBeNull()
  })

  it('should default x and y to 0 when missing', () => {
    const filePath = join(tempDir, 'no-pos.json')
    writeFileSync(filePath, JSON.stringify({ width: 1200, height: 800 }), 'utf-8')

    const result = loadWindowState(filePath)
    expect(result).toEqual({
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
      isMaximized: false,
    })
  })

  it('should default isMaximized to false when missing', () => {
    const filePath = join(tempDir, 'no-max.json')
    writeFileSync(filePath, JSON.stringify({ x: 10, y: 20, width: 1200, height: 800 }), 'utf-8')

    const result = loadWindowState(filePath)
    expect(result?.isMaximized).toBe(false)
  })
})

describe('saveWindowState', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should write valid JSON file', () => {
    const filePath = join(tempDir, 'state.json')
    const bounds: WindowBounds = { x: 50, y: 60, width: 1024, height: 768, isMaximized: false }

    saveWindowState(filePath, bounds)

    expect(existsSync(filePath)).toBe(true)
    const content = readFileSync(filePath, 'utf-8')
    expect(JSON.parse(content)).toEqual(bounds)
  })

  it('should create parent directory if it does not exist', () => {
    const filePath = join(tempDir, 'sub', 'dir', 'state.json')
    const bounds: WindowBounds = { x: 0, y: 0, width: 1200, height: 800, isMaximized: true }

    saveWindowState(filePath, bounds)

    expect(existsSync(filePath)).toBe(true)
  })

  it('should overwrite existing file', () => {
    const filePath = join(tempDir, 'state.json')
    const bounds1: WindowBounds = { x: 10, y: 20, width: 800, height: 600, isMaximized: false }
    const bounds2: WindowBounds = { x: 30, y: 40, width: 1200, height: 800, isMaximized: true }

    saveWindowState(filePath, bounds1)
    saveWindowState(filePath, bounds2)

    const result = loadWindowState(filePath)
    expect(result).toEqual(bounds2)
  })
})

describe('createDebouncedSaver', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentforge-test-'))
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should not save immediately', () => {
    const filePath = join(tempDir, 'state.json')
    const save = createDebouncedSaver(filePath, 500)

    save({ x: 0, y: 0, width: 1200, height: 800, isMaximized: false })

    expect(existsSync(filePath)).toBe(false)
  })

  it('should save after delay', () => {
    const filePath = join(tempDir, 'state.json')
    const save = createDebouncedSaver(filePath, 500)

    save({ x: 100, y: 200, width: 1200, height: 800, isMaximized: false })
    vi.advanceTimersByTime(500)

    expect(existsSync(filePath)).toBe(true)
    const result = loadWindowState(filePath)
    expect(result).toEqual({ x: 100, y: 200, width: 1200, height: 800, isMaximized: false })
  })

  it('should debounce multiple calls and only save the last one', () => {
    const filePath = join(tempDir, 'state.json')
    const save = createDebouncedSaver(filePath, 500)

    save({ x: 10, y: 20, width: 800, height: 600, isMaximized: false })
    vi.advanceTimersByTime(300)

    save({ x: 30, y: 40, width: 1024, height: 768, isMaximized: false })
    vi.advanceTimersByTime(300)

    save({ x: 50, y: 60, width: 1200, height: 800, isMaximized: true })
    vi.advanceTimersByTime(500)

    const result = loadWindowState(filePath)
    expect(result).toEqual({ x: 50, y: 60, width: 1200, height: 800, isMaximized: true })
  })
})
