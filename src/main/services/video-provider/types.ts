// AgentForge 视频生成厂商适配器抽象
// 任务引擎通过统一接口驱动不同厂商（当前 M1 仅 Seedance）。
// 各厂商 API 差异（鉴权、提交、轮询、状态映射）全部收口在适配器内。

import type { VideoProvider, VideoResolution, VideoAspect, VideoImageRef, VideoCustomProtocol } from '@shared/types'

/** 提交视频生成任务的规格 */
export interface SubmitSpec {
  prompt: string
  duration: number
  resolution: VideoResolution
  aspect: VideoAspect
  /** 图生视频/首尾帧参考图（可选） */
  imageRefs?: VideoImageRef[]
}

/** 提交结果 */
export interface SubmitResult {
  /** 厂商侧任务 ID */
  providerTaskId: string
}

/** 厂商回报的任务状态 */
export type ProviderTaskStatus =
  | 'queued'
  | 'submitted'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

/** 查询状态结果 */
export interface StatusResult {
  status: ProviderTaskStatus
  /** 进度 0-100（厂商无精确值时给出估算） */
  progress: number
  /** 成功后厂商下发的下载地址（可能带时效） */
  downloadUrl: string | null
  errorCode?: string | null
  errorMessage?: string | null
}

/** 视频生成厂商适配器 */
export interface VideoProviderAdapter {
  readonly provider: VideoProvider
  /** 提交生成任务 */
  submit(spec: SubmitSpec, config: VideoProviderConfig): Promise<SubmitResult>
  /** 查询任务状态 */
  status(providerTaskId: string, config: VideoProviderConfig): Promise<StatusResult>
}

/** 适配器运行时配置 */
export interface VideoProviderConfig {
  apiKey: string
  baseUrl: string
  model: string
  /** 仅 custom 厂商：复用的协议实现（ark=火山方舟兼容 / kling=TokenHub 兼容 / openai=OpenAI Videos 兼容），缺省 ark */
  protocol?: VideoCustomProtocol
}

/** 适配器工厂，供引擎按配置选择 */
export type VideoProviderAdapterFactory = (provider: VideoProvider) => VideoProviderAdapter