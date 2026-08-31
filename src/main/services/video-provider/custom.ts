// AgentForge 自定义视频厂商适配器
// 用户可接入任意自定义视频 API：配置 BaseUrl + 模型 + API Key，
// 并选择复用的协议实现：ark（火山方舟兼容）、kling（TokenHub 兼容）或 openai（OpenAI Videos 兼容）。
// 协议选择由 config.protocol 携带，在每次请求时动态分发。

import type { SubmitResult, StatusResult, SubmitSpec, VideoProviderAdapter, VideoProviderConfig } from './types'
import type { HttpRequestFn } from './transport'
import type { VideoCustomProtocol, VideoProvider } from '@shared/types'
import { SeedanceAdapter } from './seedance'
import { KlingAdapter } from './kling'
import { OpenAIVideoAdapter } from './openai'

/** 自定义厂商适配器：按协议委托给内置适配器 */
export class CustomAdapter implements VideoProviderAdapter {
  readonly provider: VideoProvider = 'custom'

  private readonly ark: SeedanceAdapter
  private readonly kling: KlingAdapter
  private readonly openai: OpenAIVideoAdapter

  constructor(request: HttpRequestFn) {
    this.ark = new SeedanceAdapter(request)
    this.kling = new KlingAdapter(request)
    this.openai = new OpenAIVideoAdapter(request)
  }

  private delegate(config: VideoProviderConfig): VideoProviderAdapter {
    switch (config.protocol) {
      case 'kling':
        return this.kling
      case 'openai':
        return this.openai
      default:
        return this.ark
    }
  }

  submit(spec: SubmitSpec, config: VideoProviderConfig): Promise<SubmitResult> {
    return this.delegate(config).submit(spec, config)
  }

  status(providerTaskId: string, config: VideoProviderConfig): Promise<StatusResult> {
    return this.delegate(config).status(providerTaskId, config)
  }
}

/** 自定义厂商协议归一化（非法值回退 ark） */
export function normalizeCustomProtocol(value: string | null | undefined): VideoCustomProtocol {
  return value === 'kling' || value === 'openai' ? value : 'ark'
}
