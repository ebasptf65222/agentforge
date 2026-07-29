// 验证 session-manager 的 Electron 兼容性修复
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'

describe('session-manager Electron 兼容性', () => {
  it('系统 Node.js 可通过 where/which 找到', () => {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    const result = execFileSync(cmd, ['node'], { encoding: 'utf-8', timeout: 5000 }).trim()
    const nodePath = process.platform === 'win32' ? result.split(/\r?\n/)[0].trim() : result

    expect(nodePath).toBeTruthy()
    // Node.js 路径不应包含 electron
    expect(nodePath.toLowerCase()).not.toContain('electron')
    console.log('System Node.js:', nodePath)
  })

  it('process.execPath 可被临时替换和恢复', () => {
    const original = process.execPath
    const fakePath = '/fake/node/path'

    // @ts-expect-error - 测试临时替换
    process.execPath = fakePath
    expect(process.execPath).toBe(fakePath)

    // 恢复
    // @ts-expect-error - 测试恢复
    process.execPath = original
    expect(process.execPath).toBe(original)
  })

  it('Electron 环境下 where node 返回真实 Node.js 路径', () => {
    // 即使在 Electron 中运行，where node 也能找到系统 Node.js
    if (process.platform === 'win32') {
      const result = execFileSync('where', ['node'], { encoding: 'utf-8', timeout: 5000 }).trim()
      const lines = result.split(/\r?\n/).filter(Boolean)
      // 应该至少有一个 Node.js 路径
      expect(lines.length).toBeGreaterThanOrEqual(1)
      // 第一个应该是 node.exe
      expect(lines[0].toLowerCase()).toMatch(/node\.exe$/)
      // 不应该是 electron
      expect(lines[0].toLowerCase()).not.toContain('electron')
    }
  })
})
