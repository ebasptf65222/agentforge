// AgentForge 共享类型定义 - AI 视频生成
// 覆盖视频任务生命周期、厂商配置与异步事件，供主进程/渲染进程共用。
// 集成设计见 /workspace/ai-video-generation-integration（M1 打通 Seedance 引擎链路）。

/** 视频生成厂商 */
export type VideoProvider = 'seedance' | 'kling'

/** 视频任务状态 */
export type VideoTaskStatus =
  | 'queued'
  | 'submitted'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

/** 视频分辨率 */
export type VideoResolution = '480P' | '720P' | '1080P'

/** 视频画面比例 */
export type VideoAspect = '16:9' | '9:16' | '4:3' | '3:4' | '1:1'

/** 图生视频图片角色：首帧 / 尾帧 */
export type VideoImageRole = 'first_frame' | 'last_frame'

/** 图生视频的参考图片（本地文件，由适配器 base64 内联上传） */
export interface VideoImageRef {
  /** 本地图片绝对路径 */
  path: string
  /** 首帧 first_frame / 尾帧 last_frame */
  role: VideoImageRole
}

/** 视频任务实体（持久化到 video_tasks 表） */
export interface VideoTask {
  id: string
  provider: VideoProvider
  /** 厂商侧任务 ID */
  providerTaskId: string | null
  prompt: string
  model: string
  duration: number
  resolution: VideoResolution
  aspect: VideoAspect
  status: VideoTaskStatus
  /** 进度 0-100 */
  progress: number
  errorCode: string | null
  errorMessage: string | null
  /** 厂商返回的下载地址（可能带时效） */
  downloadUrl: string | null
  /** 本地落盘相对路径（workspace/videos/...） */
  outputPath: string | null
  createdAt: number
  updatedAt: number
}

/** 创建视频任务参数 */
export interface CreateVideoTaskParams {
  prompt: string
  model?: string
  duration?: number
  resolution?: VideoResolution
  aspect?: VideoAspect
  /** 图生视频/首尾帧参考图（1 张=首帧；2 张=首尾帧） */
  imageRefs?: VideoImageRef[]
}

/** 运行时厂商配置（明文 API Key，由引擎解密后注入） */
export interface VideoProviderConfig {
  provider: VideoProvider
  apiKey: string
  baseUrl: string
  model: string
}

/** 视频域异步推送事件（主进程 → 渲染进程） */
export type VideoAsyncEvent =
  | { type: 'progress'; taskId: string; progress: number; status: VideoTaskStatus }
  | { type: 'completed'; taskId: string; outputPath: string }
  | { type: 'failed'; taskId: string; message: string }

/** 单个厂商的配置回显（不含 API Key） */
export interface VideoProviderConfigView {
  baseUrl: string
  model: string
  /** 是否已配置 API Key */
  configured: boolean
}

/** 视频生成配置回显（渲染进程设置页使用） */
export interface VideoConfigView {
  /** 默认生成厂商（设置页下拉可切换） */
  defaultProvider: VideoProvider
  /** 各厂商配置回显 */
  providers: Record<VideoProvider, VideoProviderConfigView>
  maxDuration: number
}