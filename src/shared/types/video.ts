// AgentForge 共享类型定义 - AI 视频生成
// 覆盖视频任务生命周期、厂商配置与异步事件，供主进程/渲染进程共用。
// 集成设计见 /workspace/ai-video-generation-integration（M1 打通 Seedance 引擎链路）。

/** 视频生成厂商 */
export type VideoProvider = 'seedance' | 'kling' | 'custom'

/** 自定义厂商使用的 API 协议（复用内置适配器） */
export type VideoCustomProtocol = 'ark' | 'kling' | 'openai'

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

/** 图生视频图片角色：首帧 / 尾帧 / 风格参考 */
export type VideoImageRole = 'first_frame' | 'last_frame' | 'style'

/** 图生视频的参考图片（本地文件，由适配器 base64 内联上传） */
export interface VideoImageRef {
  /** 本地图片绝对路径 */
  path: string
  /** 首帧 first_frame / 尾帧 last_frame / 风格参考 style */
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
  /** M14：是否收藏 */
  favorite: boolean
  /** M14：用户标签（任务级，最多 10 个） */
  tags: string[]
  /** M14：软删除时间戳（回收站；null 表示未删除） */
  deletedAt: number | null
  /** M15：本次任务的路由决策摘要（仅运行期展示，不落库） */
  routing?: VideoRoutingSummary
  /** M16：参考图列表（随任务持久化，可展示/带图重试） */
  imageRefs: VideoImageRef[]
  /** M18：是否已归档（成品已被移动到 archive 目录并打标） */
  archived: boolean
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
  /** M15：手动指定厂商（覆盖智能路由策略；缺省由路由决策选择） */
  providerOverride?: VideoProvider
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
  /** M14：软删除时间戳（回收站；null 表示未删除） */
  deletedAt: number | null
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

// ─── M12：生成历史统计 ─────────────────────────────────────────

/** 统计分桶（按天 / 厂商 / 模型聚合的一行） */
export interface VideoStatsBucket {
  /** 桶标识：日期（YYYY-MM-DD）/ 厂商名 / 模型名 */
  key: string
  /** 任务行总数 */
  total: number
  /** 成功任务数 */
  succeeded: number
  /** 失败任务数 */
  failed: number
  /** 取消任务数 */
  cancelled: number
  /** 未到终态（queued/submitted/running）任务数 */
  active: number
  /** 成功率（%）：succeeded ÷ 终态数 × 100，无终态时为 0 */
  successRate: number
  /** 失败率（%）：failed ÷ 终态数 × 100，无终态时为 0 */
  failureRate: number
  /** 成功任务平均耗时（秒，createdAt→updatedAt），无成功任务时为 null */
  avgElapsedSeconds: number | null
  /** 成功产出视频总时长（秒，用量） */
  videoSeconds: number
}

/** 生成历史统计总览（M12，实时聚合 video_tasks） */
export interface VideoStatsOverview {
  /** 统计起始时间戳（毫秒） */
  since: number
  /** 任务行总数 */
  total: number
  succeeded: number
  failed: number
  cancelled: number
  /** 未到终态任务数 */
  active: number
  successRate: number
  failureRate: number
  avgElapsedSeconds: number | null
  videoSeconds: number
  /** 按天分桶（本地时区 YYYY-MM-DD，仅含有任务的日期） */
  byDay: VideoStatsBucket[]
  /** 按厂商分桶 */
  byProvider: VideoStatsBucket[]
  /** 按模型分桶 */
  byModel: VideoStatsBucket[]
}

/** M12：导出统计 CSV 结果（用户取消时不落盘） */
export type VideoStatsExportResult =
  | { canceled: true }
  | { canceled: false; path: string }

// ─── M13：生成队列 ─────────────────────────────────────────────

/** 队列中的一项（排队任务 + 位置，position 从 1 开始） */
export interface VideoQueueItem {
  task: VideoTask
  position: number
}

/** 生成队列快照（M13，内存态 FIFO 队列） */
export interface VideoQueueSnapshot {
  /** 是否已暂停出队（暂停期间新任务保持排队，已提交任务不受影响） */
  paused: boolean
  /** 同时在途（已提交未终态）任务上限 */
  maxConcurrent: number
  /** 当前在途任务数 */
  activeCount: number
  /** 排队任务（按出队顺序） */
  items: VideoQueueItem[]
}

// ─── M14：视频资产管理 ─────────────────────────────────────────

/** 回收站内容（已软删的序列与任务） */
export interface VideoTrashSnapshot {
  tasks: VideoTask[]
  sequences: VideoSequence[]
}

/** 清空回收站结果 */
export interface VideoTrashPurgeResult {
  /** 彻底删除的任务数 */
  tasks: number
  /** 彻底删除的序列数 */
  sequences: number
}

/** M14：批量导出资产结果（用户取消目录选择时不落盘） */
export type VideoExportAssetsResult =
  | { canceled: true }
  | { canceled: false; targetDir: string; exported: number; skipped: Array<{ id: string; reason: string }> }

// ─── M15：跨厂商智能路由 ───────────────────────────────────────

/** 路由策略 */
export type VideoRoutingStrategy = 'fixed' | 'cost-optimized' | 'quality-first'

/** 厂商路由配置（价格与优先级，用于成本/质量策略） */
export interface VideoProviderPricing {
  provider: VideoProvider
  /** 每秒视频成本（元），成本优先策略使用 */
  costPerSecond: number
  /** 质量优先级（1=最高，数字越大优先级越低），质量优先策略使用 */
  qualityRank: number
  /** 是否启用（未启用的厂商不参与路由） */
  enabled: boolean
}

/** 智能路由配置 */
export interface VideoRoutingConfig {
  /** 路由策略 */
  strategy: VideoRoutingStrategy
  /** 各厂商价格与优先级配置 */
  providers: VideoProviderPricing[]
}

/** 路由候选（日志条目中的候选厂商明细） */
export interface VideoRoutingCandidate {
  provider: VideoProvider
  costPerSecond?: number
  qualityRank?: number
  /** 候选取舍原因 */
  reason: string
}

/** 路由决策日志条目 */
export interface VideoRoutingLogEntry {
  /** 决策时间戳 */
  timestamp: number
  /** 任务提示词（截取前 50 字符） */
  promptPreview: string
  /** 选中的厂商 */
  selectedProvider: VideoProvider
  /** 路由策略 */
  strategy: VideoRoutingStrategy
  /** 决策原因 */
  reason: string
  /** 候选厂商列表（含价格/优先级） */
  candidates: VideoRoutingCandidate[]
}

/** 任务上展示的路由决策摘要（运行期，不落库） */
export interface VideoRoutingSummary {
  strategy: VideoRoutingStrategy
  selectedProvider: VideoProvider
  reason: string
}

// ─── M17：定时/脚本化批量 ─────────────────────────────────────

/** 视频批量调度触发方式：cron 定时 / manual 手动触发 */
export type VideoScheduleTrigger = 'cron' | 'manual'

/** 视频批量调度执行状态 */
export type VideoScheduleRunStatus = 'ok' | 'error' | 'running' | 'skipped'

/** 视频批量调度批次的生成配置 */
export interface VideoBatchConfig {
  /** 批量任务行（每条 prompt 一个单视频任务） */
  rows: CreateVideoTaskParams[]
  /** 本批出队并发上限（可选，用队列当前上限；仅作用于 rows 单视频批量） */
  concurrency?: number
  /**
   * 序列行（可选）：到点逐个触发连续性衔接序列（长视频），
   * 镜头 i 尾帧自动作为镜头 i+1 首帧。与 rows/templateIds 至少一者非空。
   */
  sequences?: VideoBatchSequenceRow[]
  /** 绑定的分镜模板 id（可选，到点逐个 generateFromTemplate） */
  templateIds?: string[]
}

/** 调度批量中的序列行：到点触发一个连续性衔接序列（长视频） */
export interface VideoBatchSequenceRow {
  /** 序列标题（缺省取首镜头 prompt 截断） */
  title?: string
  /** 镜头 prompt 列表（表单按空行分段产生），至少 2 段 */
  shots: string[]
  /** 每镜时长（秒），缺省 5 */
  duration?: number
  /** 分辨率，缺省 720P */
  resolution?: VideoResolution
  /** 画面比例，缺省 16:9 */
  aspect?: VideoAspect
}

/** 视频批量调度实体（持久化到 video_schedules 表） */
export interface VideoSchedule {
  id: string
  name: string
  enabled: boolean
  trigger: VideoScheduleTrigger
  /** cron 表达式（trigger='cron' 时必填） */
  cronExpr: string | null
  /** IANA 时区（可空，缺省系统时区） */
  timezone: string | null
  /** 批次生成配置 */
  batch: VideoBatchConfig
  nextRunAtMs: number | null
  /** 正在执行的时间戳（防止并行触发） */
  runningAtMs: number | null
  lastRunAtMs: number | null
  lastStatus: VideoScheduleRunStatus | null
  /** 上一次执行提交的任务数 */
  lastRunCount: number | null
  runCount: number
  /** 连续错误计数（≥5 自动禁用） */
  errorCount: number
  createdAt: number
  updatedAt: number
}

/** 视频批量调度执行记录 */
export interface VideoScheduleRun {
  id: string
  scheduleId: string
  startedAtMs: number
  finishedAtMs: number | null
  status: VideoScheduleRunStatus
  /** 成功创建并入队的任务数 */
  taskCount: number
  /** 提交即失败的任务数 */
  failedCount: number
  summary: string | null
  error: string | null
}

/** 创建视频批量调度参数 */
export interface CreateVideoScheduleParams {
  name: string
  cronExpr?: string
  timezone?: string
  batch: VideoBatchConfig
  enabled?: boolean
  trigger?: VideoScheduleTrigger
}

/** 更新视频批量调度参数 */
export interface UpdateVideoScheduleParams {
  name?: string
  enabled?: boolean
  cronExpr?: string | null
  timezone?: string | null
  batch?: VideoBatchConfig
  trigger?: VideoScheduleTrigger
}

// ─── M18：成片后处理 ─────────────────────────────────────────

/** 后处理操作类型 */
export type VideoPostprocessType = 'subtitle' | 'watermark' | 'concat' | 'rename' | 'archive'

/** 后处理执行记录（持久化到 video_postprocess_runs 表） */
export interface VideoPostprocessRun {
  id: string
  type: VideoPostprocessType
  /** 输入源任务 id 列表 */
  taskIds: string[]
  /** 产物落盘相对路径（rename/archive 为 null） */
  outputPath: string | null
  /** 产物在视频库中的新任务 id（若生成独立成品） */
  outputTaskId: string | null
  status: 'ok' | 'error' | 'running'
  message: string | null
  createdAt: number
}

/** 拼接参数 */
export interface VideoConcatParams {
  taskIds: string[]
  outputName?: string
}

/** 字幕烧录参数 */
export interface VideoSubtitleParams {
  taskId: string
  /** SRT 字幕内容（烧录进画面） */
  content: string
  outputName?: string
}

/** 水印叠加参数 */
export interface VideoWatermarkParams {
  taskId: string
  /** 水印图片绝对路径 */
  imagePath: string
  /** 位置：左上/右上/左下/右下/居中 */
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
  outputName?: string
}

/** 重命名任务成品参数 */
export interface VideoRenameParams {
  taskId: string
  newName: string
}

/** 归档任务参数（移动到 archive 目录并打标） */
export interface VideoArchiveParams {
  taskIds: string[]
}

/** M18：后处理批量结果 */
export interface VideoPostprocessResult {
  ok: boolean
  message: string
  run?: VideoPostprocessRun
}

// ─── M19：分镜模板库 ─────────────────────────────────────────

/** 模板类型：单镜头 / 多镜头序列 */
export type VideoTemplateType = 'shot' | 'sequence'

/** 分镜/序列模板实体（持久化到 video_templates 表） */
export interface VideoTemplate {
  id: string
  name: string
  description: string
  type: VideoTemplateType
  resolution: VideoResolution
  aspect: VideoAspect
  /** 镜头列表（shot 类型长度为 1，sequence 类型 ≥1） */
  shots: VideoShot[]
  /** 是否为连续性衔接序列模板（仅 sequence 有效） */
  continuity: boolean
  model: string | null
  tags: string[]
  createdAt: number
  updatedAt: number
}

/** 创建模板参数 */
export interface CreateVideoTemplateParams {
  name: string
  description?: string
  type: VideoTemplateType
  resolution?: VideoResolution
  aspect?: VideoAspect
  shots: VideoShot[]
  continuity?: boolean
  model?: string | null
  tags?: string[]
}

/** 更新模板参数 */
export interface UpdateVideoTemplateParams {
  name?: string
  description?: string
  type?: VideoTemplateType
  resolution?: VideoResolution
  aspect?: VideoAspect
  shots?: VideoShot[]
  continuity?: boolean
  model?: string | null
  tags?: string[]
}

// ─── M20：成本与用量计费 ─────────────────────────────────────

/** 计费分桶（按厂商 / 日期 / 模型聚合的一行） */
export interface VideoBillingBucket {
  key: string
  /** 成功任务数 */
  tasks: number
  /** 成功产出视频总时长（秒） */
  videoSeconds: number
  /** 测算成本（元，=成功时长 × 厂商每秒单价） */
  cost: number
}

/** 成本与用量计费总览（M20，实时聚合 video_tasks + 路由价格配置） */
export interface VideoBillingOverview {
  since: number
  /** 成功任务总数 */
  totalTasks: number
  /** 成功产出视频总时长（秒） */
  totalVideoSeconds: number
  /** 测算总成本（元） */
  totalCost: number
  byProvider: VideoBillingBucket[]
  byDay: VideoBillingBucket[]
  byModel: VideoBillingBucket[]
}