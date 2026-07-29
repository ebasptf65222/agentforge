// PromptTemplate Store - 管理 Prompt 模板库的 Pinia store

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { PromptTemplate } from '@shared/types'
import type {
  CreatePromptTemplateParams,
  UpdatePromptTemplateParams,
} from '@/types/electron-api'
import { showToast } from '@/utils/toast'

export const usePromptTemplateStore = defineStore('promptTemplate', () => {
  // ─── State ───────────────────────────────────────────────────

  const templates = ref<PromptTemplate[]>([])
  const loading = ref(false)
  const searchQuery = ref('')
  const selectedCategory = ref<string>('all')

  // ─── Getters ─────────────────────────────────────────────────

  /** 按搜索词和分类筛选后的模板列表 */
  const filteredTemplates = computed(() => {
    let result = templates.value
    if (selectedCategory.value !== 'all') {
      result = result.filter((t) => t.category === selectedCategory.value)
    }
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase()
      result = result.filter(
        (t) => t.title.toLowerCase().includes(q) || t.content.toLowerCase().includes(q),
      )
    }
    return result
  })

  /** 所有可用分类（含 'all'） */
  const categories = computed(() => {
    const cats = new Set(templates.value.map((t) => t.category))
    return ['all', ...Array.from(cats)]
  })

  // ─── Actions ─────────────────────────────────────────────────

  /** 加载所有模板 */
  async function loadTemplates(): Promise<void> {
    loading.value = true
    try {
      templates.value = await window.electron.promptTemplate.list()
    } catch (error) {
      console.error('[PromptTemplateStore] loadTemplates failed:', error)
      showToast('加载 Prompt 模板列表失败', 'error')
    } finally {
      loading.value = false
    }
  }

  /** 创建模板 */
  async function createTemplate(
    data: CreatePromptTemplateParams,
  ): Promise<PromptTemplate | undefined> {
    try {
      const template = await window.electron.promptTemplate.create(data)
      templates.value.unshift(template)
      showToast('模板创建成功', 'success')
      return template
    } catch (error) {
      console.error('[PromptTemplateStore] createTemplate failed:', error)
      showToast('创建模板失败', 'error')
      throw error
    }
  }

  /** 更新模板 */
  async function updateTemplate(
    id: string,
    data: Omit<UpdatePromptTemplateParams, 'id'>,
  ): Promise<void> {
    try {
      await window.electron.promptTemplate.update(id, data)
      const idx = templates.value.findIndex((t) => t.id === id)
      if (idx >= 0) {
        templates.value[idx] = { ...templates.value[idx], ...data, updatedAt: Date.now() }
      }
      showToast('模板更新成功', 'success')
    } catch (error) {
      console.error('[PromptTemplateStore] updateTemplate failed:', error)
      showToast('更新模板失败', 'error')
      throw error
    }
  }

  /** 删除模板 */
  async function deleteTemplate(id: string): Promise<void> {
    try {
      await window.electron.promptTemplate.delete(id)
      templates.value = templates.value.filter((t) => t.id !== id)
      showToast('模板已删除', 'success')
    } catch (error) {
      console.error('[PromptTemplateStore] deleteTemplate failed:', error)
      showToast('删除模板失败', 'error')
      throw error
    }
  }

  /** 复制模板内容到剪贴板 */
  async function copyTemplateContent(template: PromptTemplate): Promise<void> {
    try {
      await navigator.clipboard.writeText(template.content)
      showToast('模板内容已复制到剪贴板', 'success')
    } catch {
      showToast('复制失败', 'error')
    }
  }

  return {
    templates,
    loading,
    searchQuery,
    selectedCategory,
    filteredTemplates,
    categories,
    loadTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    copyTemplateContent,
  }
})
