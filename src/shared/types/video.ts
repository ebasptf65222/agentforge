// AgentForge 共享类型定义 - AI 视频生成
// 覆盖视频任务生命周期、厂商配置与异步事件，供主进程/渲染进程共用。
// 集成设计见 /workspace/ai-video-generation-integration（M1 打通 Seedance 引擎链路）。

/** 视频生成厂商 */
export type VideoProvider = 'seedance' | 'kling' | 'custom'

/** 自定义厂商使用的 API 协议（复用内置适配器） */
export type VideoCustomProtocol = 'ark' | 'kling'

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
  /** 所属多镜头序列 ID（非 M6 多镜头时为 null） */
  sequenceId: string | null
  /** 在序列内的镜头序号（从 0 开始） */
  shotIndex: number | null
  /** 该镜头是否使用了自动衔接的尾帧作为首帧（M8 连续性） */
  isChained: boolean
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
  /** 所属多镜头序列 ID（内部，M6 多镜头子任务使用） */
  sequenceId?: string | null
  /** 序列内镜头序号 */
  shotIndex?: number | null
}

/** 单个镜头（M6 多镜头顺序生成） */
export interface VideoShot {
  /** 镜头提示词，描述该镜头的画面/动作/场景 */
  prompt: string
  /** 该镜头时长（秒，缺省用序列默认或引擎默认） */
  duration?: number
  /** 该镜头参考图（可选，1 张=首帧，2 张=首尾帧） */
  imageRefs?: VideoImageRef[]
}

/** 多镜头序列状态（复用同一套任务状态机） */
export type VideoSequenceStatus = VideoTaskStatus

/** 多镜头序列实体（持久化到 video_sequences 表） */
export interface VideoSequence {
  id: string
  /** 序列标题（可由首个镜头提示词截取） */
  title: string
  provider: VideoProvider
  status: VideoSequenceStatus
  /** 镜头总数 */
  totalCount: number
  /** 成功镜头数 */
  succeededCount: number
  /** 失败镜头数 */
  failedCount: number
  /** 已取消镜头数 */
  cancelledCount: number
  /** 是否为连续性衔接序列（M8：镜头 i 尾帧自动作为镜头 i+1 首帧） */
  continuity: boolean
  createdAt: number
  updatedAt: number
}

/** 创建多镜头序列参数 */
export interface CreateVideoSequenceParams {
  title?: string
  model?: string
  resolution?: VideoResolution
  aspect?: VideoAspect
  /** 至少 2 个镜头 */
  shots: VideoShot[]
  /**
   * 连续性衔接（M8）：为 true 时镜头 i 生成后自动截取其尾帧作为镜头 i+1 的首帧，
   * 并按顺序逐个生成以形成连贯叙事。要求镜头为纯文生（首帧由衔接提供），且厂商支持图生视频。
   * 缺省为 false（M6 并行跑批）。
   */
  continuity?: boolean
}

/** 多镜头序列详情（序列 + 其下的镜头子任务，供渲染层一次性渲染） */
export interface VideoSequenceDetail {
  sequence: VideoSequence
  /** 序列下的镜头子任务（按 shotIndex 升序） */
  tasks: VideoTask[]
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
  /** 仅 custom 厂商：使用的 API 协议 */
  protocol?: VideoCustomProtocol
}

/** 视频生成配置回显（渲染进程设置页使用） */
export interface VideoConfigView {
  /** 默认生成厂商（设置页下拉可切换） */
  defaultProvider: VideoProvider
  /** 各厂商配置回显 */
  providers: Record<VideoProvider, VideoProviderConfigView>
  maxDuration: number
}