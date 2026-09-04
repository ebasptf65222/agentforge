<script setup lang="ts">
// 视频弹窗播放器 - 点击视频封面后以模态弹窗直接播放。
// 原生 <video> + agentfile:// 流（协议支持 Range），秒开；
// 替代旧的全屏文件预览面板链路（FileViewer 装载重、且跳页打断浏览上下文）。
import { computed } from 'vue'
import { NModal } from 'naive-ui'
import type { VideoTask } from '@shared/types'

const props = defineProps<{
  show: boolean
  task: VideoTask | null
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

/** 本地播放地址（agentfile:///workspace/...） */
const playUrl = computed(() =>
  props.task && props.task.status === 'succeeded' && props.task.outputPath
    ? window.electron.workspace.buildFileUrl(props.task.outputPath)
    : '',
)

/** 生成参数摘要：模型 · 时长 · 分辨率 · 比例 */
const metaText = computed(() =>
  props.task
    ? `${props.task.model} · ${props.task.duration} 秒 · ${props.task.resolution} · ${props.task.aspect}`
    : '',
)

function fileName(filePath: string | null): string {
  if (!filePath) return ''
  return filePath.split('/').pop() ?? ''
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :bordered="false"
    :style="{ width: 'min(920px, 94vw)' }"
    class="vplayer"
    @update:show="(v: boolean) => { if (!v) emit('update:show', false) }"
  >
    <div class="vplayer__body">
      <video
        v-if="playUrl"
        :key="playUrl"
        class="vplayer__video"
        :src="playUrl"
        controls
        autoplay
        preload="metadata"
      ></video>
      <div v-else class="vplayer__empty">该视频暂无可播放的文件</div>

      <div class="vplayer__info">
        <p class="vplayer__prompt" :title="task?.prompt">{{ task?.prompt || '视频任务' }}</p>
        <div class="vplayer__meta-row">
          <span class="vplayer__meta">{{ metaText }}</span>
          <span class="vplayer__file" :title="task?.outputPath ?? ''">
            {{ fileName(task?.outputPath ?? null) }}
          </span>
        </div>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.vplayer__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.vplayer__video {
  width: 100%;
  max-height: 68vh;
  border-radius: var(--af-radius, 8px);
  background-color: #000;
  outline: none;
}

.vplayer__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16 / 9;
  border-radius: var(--af-radius, 8px);
  background-color: var(--af-bg-input, #1f2937);
  color: var(--af-text-muted, #8494ad);
  font-size: 13px;
}

.vplayer__info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.vplayer__prompt {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--af-text-primary, #f1f5f9);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  word-break: break-all;
}

.vplayer__meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.vplayer__meta {
  font-size: var(--af-font-xs, 11px);
  color: var(--af-text-muted, #8494ad);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vplayer__file {
  flex-shrink: 0;
  max-width: 45%;
  font-size: var(--af-font-xs, 11px);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--af-text-tertiary, #94a3b8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
