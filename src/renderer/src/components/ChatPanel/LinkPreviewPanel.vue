<script setup lang="ts">
// LinkPreviewPanel - 应用内链接预览面板
// 基于 Electron <webview> 标签在应用内直接预览外部链接，
// 不离开应用、不影响自定义标题栏。
// 提供地址栏、后退/前进/刷新/重新加载、在系统浏览器打开、关闭等操作。

import { ref, watch, onMounted, onUnmounted } from 'vue'
import type { WebviewTag, DidNavigateEvent, PageTitleUpdatedEvent, LoadCommitEvent } from 'electron'
import { NIcon, NSpin, NTooltip } from 'naive-ui'
import {
  ArrowBackOutlined,
  ArrowForwardOutlined,
  RefreshOutlined,
  CloseOutlined,
  OpenInNewOutlined,
  LockOutlined,
  LockOpenOutlined,
} from '@vicons/material'
import { useUiStore } from '@/stores/ui'

const uiStore = useUiStore()

const webviewRef = ref<WebviewTag | null>(null)
const currentUrl = ref('')
const pageTitle = ref('')
const isLoading = ref(false)
const canGoBack = ref(false)
const canGoForward = ref(false)
const isSecure = ref(false)
const loadFailed = ref(false)

/** 地址栏输入值（允许用户编辑后回车跳转） */
const addressInput = ref('')
const isEditingAddress = ref(false)

// ─── 生命周期绑定 ─────────────────────────────────────────────

let cleanups: Array<() => void> = []

function bindWebviewEvents(): void {
  const wv = webviewRef.value
  if (!wv) return

  const onStartLoading = (): void => {
    isLoading.value = true
    loadFailed.value = false
  }
  const onStopLoading = (): void => {
    isLoading.value = false
    syncNavState()
  }
  const onNavigate = (e: DidNavigateEvent): void => {
    currentUrl.value = e.url
    if (!isEditingAddress.value) addressInput.value = e.url
    isSecure.value = e.url.startsWith('https://')
    syncNavState()
  }
  const onPageTitle = (e: PageTitleUpdatedEvent): void => {
    pageTitle.value = e.title
  }
  const onFailLoad = (e: LoadCommitEvent): void => {
    // errorCode !== -3 (ABORTED) 才算真正失败
    if (e.errorCode !== 0 && e.errorCode !== -3 && e.isMainFrame) {
      loadFailed.value = true
      isLoading.value = false
    }
  }

  wv.addEventListener('did-start-loading', onStartLoading)
  wv.addEventListener('did-stop-loading', onStopLoading)
  wv.addEventListener('did-navigate', onNavigate)
  wv.addEventListener('did-navigate-in-page', onNavigate)
  wv.addEventListener('page-title-updated', onPageTitle)
  wv.addEventListener('did-fail-load', onFailLoad)

  cleanups.push(() => {
    wv.removeEventListener('did-start-loading', onStartLoading)
    wv.removeEventListener('did-stop-loading', onStopLoading)
    wv.removeEventListener('did-navigate', onNavigate)
    wv.removeEventListener('did-navigate-in-page', onNavigate)
    wv.removeEventListener('page-title-updated', onPageTitle)
    wv.removeEventListener('did-fail-load', onFailLoad)
  })
}

function syncNavState(): void {
  const wv = webviewRef.value
  if (!wv) return
  canGoBack.value = wv.canGoBack()
  canGoForward.value = wv.canGoForward()
}

onMounted(() => {
  bindWebviewEvents()
})

onUnmounted(() => {
  for (const fn of cleanups) fn()
  cleanups = []
})

// URL 变化时重置 webview（v-if 重建即可，这里同步地址栏）
watch(
  () => uiStore.linkPreviewUrl,
  (url) => {
    if (url) {
      currentUrl.value = url
      addressInput.value = url
      pageTitle.value = ''
      isSecure.value = url.startsWith('https://')
    }
  },
  { immediate: true },
)

// ─── 操作 ─────────────────────────────────────────────────────

function handleBack(): void {
  webviewRef.value?.goBack()
}

function handleForward(): void {
  webviewRef.value?.goForward()
}

function handleReload(): void {
  loadFailed.value = false
  webviewRef.value?.reload()
}

function handleAddressEnter(): void {
  isEditingAddress.value = false
  const raw = addressInput.value.trim()
  if (!raw) return
  // 无协议时自动补 https://
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    // 简单合法性校验
    new URL(url)
    uiStore.openLinkPreview(url)
  } catch {
    // 非法输入，还原显示当前 URL
    addressInput.value = currentUrl.value
  }
}

function handleOpenExternal(): void {
  if (currentUrl.value) {
    void window.electron.system.openExternal(currentUrl.value)
  }
}

function handleClose(): void {
  uiStore.closeLinkPreview()
}
</script>

<template>
  <aside v-if="uiStore.linkPreviewUrl" class="link-preview">
    <!-- 工具栏 -->
    <div class="link-preview__toolbar">
      <div class="link-preview__nav-btns">
        <NTooltip placement="bottom" :delay="400">
          <template #trigger>
            <button
              class="link-preview__btn"
              type="button"
              title="后退"
              :disabled="!canGoBack"
              @click="handleBack"
            >
              <NIcon :size="16"><ArrowBackOutlined /></NIcon>
            </button>
          </template>
          <span>后退</span>
        </NTooltip>
        <NTooltip placement="bottom" :delay="400">
          <template #trigger>
            <button
              class="link-preview__btn"
              type="button"
              title="前进"
              :disabled="!canGoForward"
              @click="handleForward"
            >
              <NIcon :size="16"><ArrowForwardOutlined /></NIcon>
            </button>
          </template>
          <span>前进</span>
        </NTooltip>
        <NTooltip placement="bottom" :delay="400">
          <template #trigger>
            <button class="link-preview__btn" type="button" title="刷新" @click="handleReload">
              <NSpin v-if="isLoading" :size="12" />
              <NIcon v-else :size="16"><RefreshOutlined /></NIcon>
            </button>
          </template>
          <span>刷新</span>
        </NTooltip>
      </div>

      <!-- 地址栏 -->
      <div class="link-preview__address-bar">
        <NIcon :size="13" class="link-preview__lock" :class="{ 'is-insecure': !isSecure }">
          <LockOutlined v-if="isSecure" />
          <LockOpenOutlined v-else />
        </NIcon>
        <input
          v-model="addressInput"
          class="link-preview__address-input"
          type="text"
          spellcheck="false"
          placeholder="输入网址后回车"
          @focus="isEditingAddress = true"
          @blur="isEditingAddress = false"
          @keydown.enter="handleAddressEnter"
          @keydown.esc="addressInput = currentUrl; isEditingAddress = false"
        />
      </div>

      <div class="link-preview__actions">
        <NTooltip placement="bottom" :delay="400">
          <template #trigger>
            <button
              class="link-preview__btn"
              type="button"
              title="在系统浏览器打开"
              @click="handleOpenExternal"
            >
              <NIcon :size="16"><OpenInNewOutlined /></NIcon>
            </button>
          </template>
          <span>在系统浏览器打开</span>
        </NTooltip>
        <NTooltip placement="bottom" :delay="400">
          <template #trigger>
            <button
              class="link-preview__btn"
              type="button"
              title="关闭预览"
              @click="handleClose"
            >
              <NIcon :size="16"><CloseOutlined /></NIcon>
            </button>
          </template>
          <span>关闭预览</span>
        </NTooltip>
      </div>
    </div>

    <!-- 页面标题条 -->
    <div v-if="pageTitle" class="link-preview__title" :title="currentUrl">
      {{ pageTitle }}
    </div>

    <!-- webview 内容区 -->
    <div class="link-preview__content">
      <webview
        ref="webviewRef"
        class="link-preview__webview"
        :src="uiStore.linkPreviewUrl"
        allowpopups="false"
      />
      <!-- 加载失败提示 -->
      <div v-if="loadFailed" class="link-preview__error">
        <p class="link-preview__error-text">页面加载失败</p>
        <button class="link-preview__error-retry" type="button" @click="handleReload">
          重新加载
        </button>
        <button class="link-preview__error-external" type="button" @click="handleOpenExternal">
          在系统浏览器打开
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.link-preview {
  width: 480px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--af-border, #374151);
  background-color: var(--af-bg, #0f172a);
  overflow: hidden;
}

.link-preview__toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background-color: var(--af-bg-surface, #111827);
  border-bottom: 1px solid var(--af-border, #374151);
  flex-shrink: 0;
}

.link-preview__nav-btns,
.link-preview__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.link-preview__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: var(--af-radius-sm, 6px);
  background-color: transparent;
  color: var(--af-text-tertiary, #9ca3af);
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.link-preview__btn:hover:not(:disabled) {
  background-color: var(--af-bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--af-text-primary, #e5e7eb);
}

.link-preview__btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.link-preview__address-bar {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 26px;
  padding: 0 10px;
  background-color: var(--af-bg-input, #1f2937);
  border: 1px solid var(--af-border, #374151);
  border-radius: 13px;
  transition: border-color 0.15s ease;
}

.link-preview__address-bar:focus-within {
  border-color: var(--af-brand, #818cf8);
}

.link-preview__lock {
  color: var(--af-success, #34d399);
  flex-shrink: 0;
}

.link-preview__lock.is-insecure {
  color: var(--af-warning, #f59e0b);
}

.link-preview__address-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12px;
  color: var(--af-text-primary, #e5e7eb);
  font-family: inherit;
}

.link-preview__address-input::placeholder {
  color: var(--af-text-muted, #64748b);
}

.link-preview__title {
  padding: 4px 12px;
  font-size: 11px;
  color: var(--af-text-tertiary, #94a3b8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-bottom: 1px solid var(--af-border, #374151);
  background-color: var(--af-bg-surface, #111827);
  flex-shrink: 0;
  user-select: none;
}

.link-preview__content {
  flex: 1;
  position: relative;
  min-height: 0;
  display: flex;
}

.link-preview__webview {
  flex: 1;
  width: 100%;
  height: 100%;
  border: none;
  background-color: #ffffff;
}

.link-preview__error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background-color: var(--af-bg, #0f172a);
  z-index: 2;
}

.link-preview__error-text {
  font-size: 14px;
  color: var(--af-text-secondary, #cbd5e1);
  margin: 0;
}

.link-preview__error-retry,
.link-preview__error-external {
  padding: 6px 16px;
  border: 1px solid var(--af-border, #374151);
  border-radius: var(--af-radius-sm, 6px);
  background-color: var(--af-bg-input, #1f2937);
  color: var(--af-text-primary, #e5e7eb);
  font-size: 13px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.link-preview__error-retry:hover,
.link-preview__error-external:hover {
  background-color: var(--af-bg-hover, #374151);
}
</style>
