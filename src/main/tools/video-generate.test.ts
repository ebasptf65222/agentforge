// AgentForge: video_generate 内置工具测试
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { videoGenerateTool } from './video-generate'
import * as videoEngine from '../services/video-engine'
import { AppError, ErrorCodes } from '../utils/error'

describe('videoGenerateTool', () => {
  let generateSpy: ReturnType<typeof vi.spyOn>
  let generateSequenceSpy: ReturnType<typeof vi.spyOn>
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
    sequenceId: null,
    shotIndex: null,
    createdAt: 1,
    updatedAt: 1,
  }

  const fakeSequence = {
    sequence: {
      id: 'seq-1',
      title: 'story',
      provider: 'seedance',
      status: 'submitted',
      totalCount: 2,
      succeededCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      createdAt: 1,
      updatedAt: 1,
    },
    tasks: [fakeTask, fakeTask],
  }

  beforeEach(() => {
    generateSpy = vi
      .spyOn(videoEngine.VideoEngine.prototype, 'generate')
      .mockResolvedValue(fakeTask as never)
    generateSequenceSpy = vi
      .spyOn(videoEngine.VideoEngine.prototype, 'generateSequence')
      .mockResolvedValue(fakeSequence as never)
    configSpy = vi.spyOn(videoEngine, 'loadVideoConfig')
  })

  afterEach(() => {
    generateSpy.mockRestore()
    generateSequenceSpy.mockRestore()
    configSpy.mockRestore()
  })

  describe('definition', () => {
    it('should have correct name', () => {
      expect(videoGenerateTool.definition.name).toBe('video_generate')
    })

    it('should be medium risk', () => {
      expect(videoGenerateTool.definition.riskLevel).toBe('medium')
    })

    it('should expose prompt as a property (conditionally required)', () => {
      const props = videoGenerateTool.definition.inputSchema.properties as Record<
        string,
        Record<string, unknown>
      >
      expect(props['prompt']).toBeDefined()
      expect(props['shots']).toBeDefined()
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

    it('should map a single image to first_frame and forward imageRefs', async () => {
      configSpy.mockReturnValue({ provider: 'seedance', apiKey: 'k', baseUrl: 'u', model: 'm' })
      const result = await videoGenerateTool.execute({
        prompt: 'animate',
        images: ['/tmp/a.png'],
      })

      expect(generateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          imageRefs: [{ path: '/tmp/a.png', role: 'first_frame' }],
        }),
      )
      expect(result.metadata).toMatchObject({ imageCount: 1 })
    })

    it('should map two images to first+last frame', async () => {
      configSpy.mockReturnValue({ provider: 'seedance', apiKey: 'k', baseUrl: 'u', model: 'm' })
      await videoGenerateTool.execute({ prompt: 'animate', images: ['/tmp/a.png', '/tmp/b.png'] })

      expect(generateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          imageRefs: [
            { path: '/tmp/a.png', role: 'first_frame' },
            { path: '/tmp/b.png', role: 'last_frame' },
          ],
        }),
      )
    })

    it('should throw VALIDATION_ERROR for more than two images', async () => {
      configSpy.mockReturnValue({ provider: 'seedance', apiKey: 'k', baseUrl: 'u', model: 'm' })
      await expect(
        videoGenerateTool.execute({ prompt: 'animate', images: ['/tmp/a.png', '/tmp/b.png', '/tmp/c.png'] }),
      ).rejects.toSatisfy(
        (e: AppError) =>
          e instanceof AppError && e.code === ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should throw VALIDATION_ERROR when images is not an array of strings', async () => {
      configSpy.mockReturnValue({ provider: 'seedance', apiKey: 'k', baseUrl: 'u', model: 'm' })
      await expect(
        videoGenerateTool.execute({ prompt: 'animate', images: 'not-an-array' }),
      ).rejects.toSatisfy(
        (e: AppError) =>
          e instanceof AppError && e.code === ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should treat empty images array as text-to-video', async () => {
      configSpy.mockReturnValue({ provider: 'seedance', apiKey: 'k', baseUrl: 'u', model: 'm' })
      await videoGenerateTool.execute({ prompt: 'animate', images: [] })

      expect(generateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ imageRefs: undefined }),
      )
    })

    it('should reject images when provider is Kling (via engine)', async () => {
      configSpy.mockReturnValue({ provider: 'kling', apiKey: 'k', baseUrl: 'u', model: 'm' })
      generateSpy.mockRejectedValueOnce(
        new AppError(ErrorCodes.VIDEO_INVALID_CONFIG, 'Kling 图生视频暂未支持'),
      )
      await expect(
        videoGenerateTool.execute({ prompt: 'animate', images: ['/tmp/a.png'] }),
      ).rejects.toSatisfy(
        (e: AppError) =>
          e instanceof AppError && e.code === ErrorCodes.VIDEO_INVALID_CONFIG,
      )
    })
  })

  describe('execute (M6 multi-shot)', () => {
    beforeEach(() => {
      configSpy.mockReturnValue({ provider: 'seedance', apiKey: 'k', baseUrl: 'u', model: 'm' })
    })

    it('should delegate to generateSequence when shots provided', async () => {
      const result = await videoGenerateTool.execute({
        shots: [{ prompt: 'shot one' }, { prompt: 'shot two' }],
      })

      expect(generateSequenceSpy).toHaveBeenCalledTimes(1)
      expect(generateSequenceSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          shots: [{ prompt: 'shot one' }, { prompt: 'shot two' }],
        }),
      )
      expect(result.isError).toBe(false)
      expect(result.content).toContain('seq-1')
      expect(result.metadata).toMatchObject({ sequenceId: 'seq-1', shotCount: 2 })
    })

    it('should forward common resolution/aspect to the sequence', async () => {
      await videoGenerateTool.execute({
        shots: [{ prompt: 'a' }, { prompt: 'b' }],
        resolution: '1080P',
        aspect: '9:16',
        model: 'custom-model',
      })

      expect(generateSequenceSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          resolution: '1080P',
          aspect: '9:16',
          model: 'custom-model',
        }),
      )
    })

    it('should forward continuity=true as the sequence continuity mode (M8)', async () => {
      generateSequenceSpy.mockResolvedValue({
        sequence: { id: 'seq-1', continuity: true, totalCount: 2, status: 'running', provider: 'seedance' },
        tasks: [],
      })

      await videoGenerateTool.execute({
        shots: [{ prompt: 'a' }, { prompt: 'b' }],
        continuity: true,
      })

      expect(generateSequenceSpy).toHaveBeenCalledWith(
        expect.objectContaining({ continuity: true }),
      )
    })

    it('should map per-shot images to imageRefs', async () => {
      await videoGenerateTool.execute({
        shots: [
          { prompt: 'a', images: ['/tmp/f.png'] },
          { prompt: 'b', images: ['/tmp/x.png', '/tmp/y.png'] },
        ],
      })

      expect(generateSequenceSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          shots: [
            { prompt: 'a', duration: undefined, imageRefs: [{ path: '/tmp/f.png', role: 'first_frame' }] },
            {
              prompt: 'b',
              duration: undefined,
              imageRefs: [
                { path: '/tmp/x.png', role: 'first_frame' },
                { path: '/tmp/y.png', role: 'last_frame' },
              ],
            },
          ],
        }),
      )
    })

    it('should throw VALIDATION_ERROR for shots with fewer than 2 entries', async () => {
      await expect(
        videoGenerateTool.execute({ shots: [{ prompt: 'only one' }] }),
      ).rejects.toSatisfy(
        (e: AppError) =>
          e instanceof AppError && e.code === ErrorCodes.VALIDATION_ERROR,
      )
      expect(generateSequenceSpy).not.toHaveBeenCalled()
    })

    it('should throw VALIDATION_ERROR when shots is not an array', async () => {
      await expect(
        videoGenerateTool.execute({ shots: 'not-an-array' }),
      ).rejects.toSatisfy(
        (e: AppError) =>
          e instanceof AppError && e.code === ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should throw VALIDATION_ERROR when a shot lacks a prompt', async () => {
      await expect(
        videoGenerateTool.execute({ shots: [{ prompt: 'a' }, { prompt: '   ' }] }),
      ).rejects.toSatisfy(
        (e: AppError) =>
          e instanceof AppError && e.code === ErrorCodes.VALIDATION_ERROR,
      )
    })

    it('should throw VALIDATION_ERROR when a per-shot image array exceeds 2', async () => {
      await expect(
        videoGenerateTool.execute({
          shots: [
            { prompt: 'a' },
            { prompt: 'b', images: ['/tmp/1.png', '/tmp/2.png', '/tmp/3.png'] },
          ],
        }),
      ).rejects.toSatisfy(
        (e: AppError) =>
          e instanceof AppError && e.code === ErrorCodes.VALIDATION_ERROR,
      )
    })
  })
})