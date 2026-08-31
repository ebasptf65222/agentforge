<script setup lang="ts">
// M3: VideoMessage - 聊天消息中的视频渲染
// 通过消息元数据 videoTaskId 定位视频任务；若任务仍在进行，持续展示进度卡。

import { computed, onMounted } from 'vue'
import { useVideoStore } from '@/stores/video'
import VideoTaskCard from '@/components/video/VideoTaskCard.vue'

const props = defineProps<{
  taskId: string
}>()

const emit = defineEmits<{
  open: [relativePath: string]
}>()

const videoStore = useVideoStore()

onMounted(() => {
  // 确保事件订阅与任务数据就绪
  videoStore.init()
})

const task = computed(() => videoStore.getTask(props.taskId))
</script>

<template>
  <div class="video-message">
    <VideoTaskCard v-if="task" :task="task" @open="(p) => emit('open', p)" />
    <div v-else class="video-message__missing">
      <span class="video-message__label">视频任务 {{ taskId }}</span>
      <span class="video-message__hint">任务数据不存在，可能已被删除。</span>
    </div>
  </div>
</template>

<style scoped>
.video-message {
  margin-top: 6px;
}

.video-message__missing {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: var(--af-text-secondary, #9ca3af);
  background-color: var(--af-bg-surface, #1e293b);
  border: 1px dashed var(--af-border, #334155);
  border-radius: 10px;
  padding: 12px 14px;
}

.video-message__label {
  font-family: ui-monospace, Menlo, Consolas, monospace;
}

.video-message__hint {
  font-size: 12px;
  color: var(--af-text-muted, #6b7280);
}
</style>