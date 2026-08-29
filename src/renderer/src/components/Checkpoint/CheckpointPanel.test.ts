// P2-02: CheckpointPanel component test
// Verifies that the component mounts without errors after the `computed` import fix.
// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

// ─── Mock window.electron ──────────────────────────────────
const mockCheckpointList = vi.fn().mockResolvedValue({ checkpoints: [], count: 0 })
const mockCheckpointDiff = vi.fn().mockResolvedValue(null)
const mockCheckpointRollback = vi.fn().mockResolvedValue({ success: true, relativePath: 'test.ts', action: 'write' })
const mockCheckpointDelete = vi.fn().mockResolvedValue(undefined)
const mockCheckpointCleanup = vi.fn().mockResolvedValue({ deleted: 0 })

vi.stubGlobal('window', {
  electron: {
    checkpoint: {
      list: mockCheckpointList,
      diff: mockCheckpointDiff,
      rollback: mockCheckpointRollback,
      delete: mockCheckpointDelete,
      cleanup: mockCheckpointCleanup,
    },
  },
})

// ─── Mock naive-ui components ──────────────────────────────
// @vue/test-utils + happy-dom can handle naive-ui, but we need to
// ensure the component tree is shallow enough to mount.

import CheckpointPanel from './CheckpointPanel.vue'

describe('CheckpointPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('imports CheckpointPanel without error', () => {
    expect(CheckpointPanel).toBeDefined()
  })

  it('mounts without throwing', async () => {
    const wrapper = mount(CheckpointPanel, {
      global: {
        plugins: [createPinia()],
      },
    })
    expect(wrapper.exists()).toBe(true)
  })

  it('renders the panel header with title', async () => {
    const wrapper = mount(CheckpointPanel, {
      global: {
        plugins: [createPinia()],
      },
    })
    // The header title should be rendered
    expect(wrapper.text()).toContain('文件快照时间线')
  })

  it('shows empty state when no checkpoints', async () => {
    const wrapper = mount(CheckpointPanel, {
      global: {
        plugins: [createPinia()],
      },
    })
    // Should show empty state message
    expect(wrapper.text()).toContain('暂无文件快照')
  })

  it('calls loadCheckpoints on mount', async () => {
    mount(CheckpointPanel, {
      global: {
        plugins: [createPinia()],
      },
    })
    expect(mockCheckpointList).toHaveBeenCalledTimes(1)
  })
})