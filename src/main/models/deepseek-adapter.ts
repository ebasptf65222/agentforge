// AgentForge P1-07: DeepSeek 模型适配器
// 继承 OpenAIAdapter，默认 baseUrl = 'https://api.deepseek.com/v1'

import { OpenAIAdapter, type OpenAIAdapterConfig } from './openai-adapter'

/**
 * DeepSeek 适配器配置。
 */
export interface DeepSeekAdapterConfig extends Omit<OpenAIAdapterConfig, 'baseUrl'> {
  baseUrl?: string
}

/** DeepSeek API 默认地址 */
const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'

/**
 * DeepSeek 模型适配器。
 * 继承 OpenAIAdapter，复用 streamChat 逻辑。
 * 默认 baseURL 设为 DeepSeek API 地址，支持自定义覆盖。
 */
export class DeepSeekAdapter extends OpenAIAdapter {
  constructor(config: DeepSeekAdapterConfig) {
    super({
      ...config,
      baseUrl: config.baseUrl ?? DEEPSEEK_DEFAULT_BASE_URL,
    })
  }
}
