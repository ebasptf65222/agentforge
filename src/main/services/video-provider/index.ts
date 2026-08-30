// AgentForge 视频厂商适配器注册中心
// 提供按 provider 创建适配器，M4 可在此扩展 Kling / Veo 等第二、第三厂商。

import type { VideoProvider } from '@shared/types'
import type { VideoProviderAdapter } from './types'
import { SeedanceAdapter } from './seedance'
import type { HttpRequestFn } from './transport'
import { AppError, ErrorCodes } from '../../utils/error'

/**
 * 创建指定厂商的适配器。
 *
 * @param provider - 厂商标识（当前支持 'seedance'）
 * @param request - 可注入的 HTTP 请求函数（测试用）
 * @throws {AppError} VIDEO_INVALID_CONFIG - 未知厂商
 */
export function createVideoProviderAdapter(
  provider: VideoProvider,
  request?: HttpRequestFn,
): VideoProviderAdapter {
  switch (provider) {
    case 'seedance':
      return new SeedanceAdapter(request)
    default:
      throw new AppError(ErrorCodes.VIDEO_INVALID_CONFIG, `Unsupported video provider: ${provider}`)
  }
}