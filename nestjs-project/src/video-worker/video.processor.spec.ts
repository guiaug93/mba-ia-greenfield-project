/* eslint-disable @typescript-eslint/unbound-method */
import { Job } from 'bullmq';
import { Test } from '@nestjs/testing';
import * as childProcessModule from 'child_process';
import { VideoProcessor } from './video.processor';
import { VideosService } from '../videos/videos.service';
import { StorageService } from '../storage/storage.service';
import { Video, VideoStatus } from '../videos/entities/video.entity';

const mockVideo: Video = {
  id: 'video-id',
  channelId: 'channel-id',
  title: 'Test Video',
  status: VideoStatus.PENDING,
  statusMessage: null,
  fileKey: 'videos/video-id/master.mp4',
  fileSize: null,
  thumbnailKey: null,
  duration: null,
  mimeType: 'video/mp4',
  metadata: null,
  uploadId: 'upload-123',
  createdAt: new Date(),
  updatedAt: new Date(),
  channel: null as never,
};

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  mkdtemp: jest.fn().mockResolvedValue('/tmp/test-video-dir'),
  rm: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(Buffer.from('fake-thumbnail-data')),
}));

describe('VideoProcessor', () => {
  let processor: VideoProcessor;
  let videosService: jest.Mocked<VideosService>;
  let storageService: jest.Mocked<StorageService>;

  const setupMockSuccess = () => {
    const mockExec = childProcessModule.execFile as unknown as jest.Mock;
    mockExec.mockImplementation(
      (
        _file: string,
        _args: string[] | null | undefined,
        _optionsOrCb: unknown,
        _cb?: unknown,
      ) => {
        const callback = (
          typeof _optionsOrCb === 'function' ? _optionsOrCb : _cb
        ) as ((err: Error | null, result?: { stdout: string }) => void) | null;
        if (callback) {
          if (_file === 'ffprobe') {
            callback(null, {
              stdout: JSON.stringify({
                format: {
                  duration: '123.456',
                  size: '1048576',
                  bit_rate: '256000',
                  format_name: 'mp4',
                },
                streams: [
                  {
                    codec_type: 'video',
                    codec_name: 'h264',
                    width: 1920,
                    height: 1080,
                  },
                ],
              }),
            });
          } else {
            callback(null, { stdout: '' });
          }
        }
      },
    );
  };

  const setupMockError = () => {
    const mockExec = childProcessModule.execFile as unknown as jest.Mock;
    mockExec.mockImplementation(
      (
        _file: string,
        _args: string[] | null | undefined,
        _optionsOrCb: unknown,
        _cb?: unknown,
      ) => {
        const callback = (
          typeof _optionsOrCb === 'function' ? _optionsOrCb : _cb
        ) as ((err: Error | null, result?: { stdout: string }) => void) | null;
        if (callback) {
          callback(new Error('FFprobe failed'));
        }
      },
    );
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    setupMockSuccess();

    const module = await Test.createTestingModule({
      providers: [
        VideoProcessor,
        {
          provide: VideosService,
          useValue: {
            findById: jest.fn(),
            updateAfterProcessing: jest.fn(),
            markAsError: jest.fn(),
          },
        },
        {
          provide: StorageService,
          useValue: {
            downloadToFile: jest.fn(),
            uploadFile: jest.fn(),
          },
        },
      ],
    }).compile();

    processor = module.get(VideoProcessor);
    videosService = module.get(VideosService);
    storageService = module.get(StorageService);
  });

  describe('process', () => {
    it('should process a video successfully', async () => {
      videosService.findById.mockResolvedValue(mockVideo);
      videosService.updateAfterProcessing.mockResolvedValue({
        ...mockVideo,
        status: VideoStatus.READY,
        duration: 123,
        metadata: {} as unknown as Record<string, unknown>,
        thumbnailKey: 'thumbnails/video-id/thumbnail.jpg',
        fileSize: 1048576,
      });

      const job = { id: 'job-1', data: { videoId: 'video-id' } } as Job<{
        videoId: string;
      }>;

      await processor.process(job);

      expect(storageService.downloadToFile).toHaveBeenCalled();
      expect(videosService.updateAfterProcessing).toHaveBeenCalledWith(
        'video-id',
        123,
        expect.any(Object),
        'thumbnails/video-id/thumbnail.jpg',
        1048576,
      );
    });

    it('should handle processing errors gracefully', async () => {
      jest.clearAllMocks();
      setupMockError();

      videosService.findById.mockResolvedValue(mockVideo);

      const job = { id: 'job-2', data: { videoId: 'video-id' } } as Job<{
        videoId: string;
      }>;

      await expect(processor.process(job)).rejects.toThrow('FFprobe failed');
      expect(videosService.markAsError).toHaveBeenCalledWith(
        'video-id',
        'FFprobe failed',
      );
    });

    it('should mark error when video is not found', async () => {
      videosService.findById.mockRejectedValue(new Error('Video not found'));

      const job = { id: 'job-3', data: { videoId: 'invalid-id' } } as Job<{
        videoId: string;
      }>;

      await expect(processor.process(job)).rejects.toThrow('Video not found');
      expect(videosService.markAsError).toHaveBeenCalledWith(
        'invalid-id',
        'Video not found',
      );
    });
  });
});
