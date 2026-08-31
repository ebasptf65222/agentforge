// AgentForge: video_generate 内置工具测试
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { videoGenerateTool } from './video-generate'
import * as videoEngine from '../services/video-engine'
import { AppError, ErrorCodes } from '../utils/error'

describe('videoGenerateTool', () => {
  let generateSpy: ReturnType<typeof vi.spyOn>
  let configSpy: ReturnType<typeof vi.spyOn>

  const fakeTask = {
    id: 'task-1',
    provider: 'seedance',
    providerTaskId: 'pt-1',
    prompt: 'a cat jumping',
    model: 'doubao-seedance',
    duration: 5,
    resolution: '720P',
    aspect: '16:9',
    status: 'submitted',
    progress: 5,
    errorCode: null,
    errorMessage: null,
    downloadUrl: null,
    outputPath: null,
    createdAt: 1,
    updatedAt: 1,
  }

  beforeEach(() => {
    generateSpy = vi
      .spyOn(videoEngine.VideoEngine.prototype, 'generate')
      .mockResolvedValue(fakeTask as never)
    configSpy = vi.spyOn(videoEngine, 'loadVideoConfig')
  })

  afterEach(() => {
    generateSpy.mockRestore()
    configSpy.mockRestore()
  })

  describe('definition', () => {
    it('should have correct name', () => {
      expect(videoGenerateTool.definition.name).toBe('video_generate')
    })

    it('should be medium risk', () => {
      expect(videoGenerateTool.definition.riskLevel).toBe('medium')
    })

    it('should have prompt as required parameter', () => {
      const required = videoGenerateTool.definition.inputSchema.required as string[]
      expect(required).toContain('prompt')
    })

    it('should expose enum options for resolution and aspect', () => {
      const props = videoGenerateTool.definition.inputSchema.properties as Record<
        string,
        { enum?: string[] }
      >
      expect(props['resolution']?.enum).toEqual(['480P', '720P', '1080P'])
      expect(props['aspect']?.enum).toEqual(['16:9', '9:16', '4:3', '3:4', '1:1'])
    })
  })

  describe('execute', () => {
    it('should throw VALIDATION_ERROR when prompt is empty', async () => {
      await expect(videoGenerateTool.execute({ prompt: '   ' })).rejects.toSatisfy(
        (e: AppError) =>
          e instanceof AppError && e.code === ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should throw VALIDATION_ERROR for invalid resolution', async () => {
      configSpy.mockReturnValue({ provider: 'seedance', apiKey: 'k', baseUrl: 'u', model: 'm' })
      await expect(
        videoGenerateTool.execute({ prompt: 'test', resolution: '4K' }),
      ).rejects.toSatisfy(
        (e: AppError) =>
          e instanceof AppError && e.code === ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should throw config error when not configured', async () => {
      configSpy.mockImplementation(() => {
        throw new AppError(
          ErrorCodes.VIDEO_INVALID_CONFIG,
          'Video generation is not configured.',
        )
      })
      await expect(videoGenerateTool.execute({ prompt: 'test' })).rejects.toSatisfy(
        (e: AppError) => e instanceof AppError && e.code === ErrorCodes.VIDEO_INVALID_CONFIG,
      )
    })

    it('should submit a generation task with prompt', async () => {
      configSpy.mockReturnValue({ provider: 'seedance', apiKey: 'k', baseUrl: 'u', model: 'm' })
      const result = await videoGenerateTool.execute({ prompt: 'a cat jumping' })

      expect(generateSpy).toHaveBeenCalledTimes(1)
      expect(generateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'a cat jumping' }),
      )
      expect(result.isError).toBe(false)
      expect(result.content).toContain('task-1')
    })

    it('should forward optional params to the engine', async () => {
      configSpy.mockReturnValue({ provider: 'seedance', apiKey: 'k', baseUrl: 'u', model: 'm' })
      await videoGenerateTool.execute({
        prompt: 'test',
        duration: 8,
        resolution: '1080P',
        aspect: '9:16',
        model: 'custom-model',
      })

      expect(generateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          duration: 8,
          resolution: '1080P',
          aspect: '9:16',
          model: 'custom-model',
        }),
      )
    })

    it('should include task metadata in result', async () => {
      configSpy.mockReturnValue({ provider: 'seedance', apiKey: 'k', baseUrl: 'u', model: 'm' })
      const result = await videoGenerateTool.execute({ prompt: 'test' })

      expect(result.metadata).toMatchObject({
        taskId: 'task-1',
        provider: 'seedance',
        status: 'submitted',
      })
    })
  })
})