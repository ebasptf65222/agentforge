// Skill Store - 管理 Skill 配置的 Pinia store

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Skill } from '@shared/types'
import type { CreateSkillParams, UpdateSkillParams, ListSkillParams } from '@/types/electron-api'
import { showToast } from '@/utils/toast'

export const useSkillStore = defineStore('skill', () => {
  // ─── State ───────────────────────────────────────────────────

  const skills = ref<Skill[]>([])
  const loading = ref(false)

  // ─── Actions ─────────────────────────────────────────────────

  async function loadSkills(params?: ListSkillParams): Promise<void> {
    loading.value = true
    try {
      skills.value = await window.electron.skill.list(params)
    } catch (error) {
      console.error('[SkillStore] loadSkills failed:', error)
      showToast('加载 Skills 列表失败', 'error')
    } finally {
      loading.value = false
    }
  }

  async function createSkill(params: CreateSkillParams): Promise<void> {
    try {
      await window.electron.skill.create(params)
      showToast('Skill 创建成功', 'success')
      await loadSkills()
    } catch (error) {
      console.error('[SkillStore] createSkill failed:', error)
      showToast('创建 Skill 失败', 'error')
      throw error
    }
  }

  async function updateSkill(params: UpdateSkillParams): Promise<void> {
    try {
      await window.electron.skill.update(params)
      showToast('Skill 更新成功', 'success')
      await loadSkills()
    } catch (error) {
      console.error('[SkillStore] updateSkill failed:', error)
      showToast('更新 Skill 失败', 'error')
      throw error
    }
  }

  async function deleteSkill(id: string): Promise<void> {
    try {
      await window.electron.skill.delete(id)
      showToast('Skill 已删除', 'success')
      await loadSkills()
    } catch (error) {
      console.error('[SkillStore] deleteSkill failed:', error)
      showToast('删除 Skill 失败', 'error')
      throw error
    }
  }

  /** 获取手动触发的 Skills（用于聊天界面选择） */
  function manualSkills(): Skill[] {
    return skills.value.filter((s) => s.trigger === 'manual')
  }

  return {
    skills,
    loading,
    loadSkills,
    createSkill,
    updateSkill,
    deleteSkill,
    manualSkills,
  }
})
