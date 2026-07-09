import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  VideoNotFoundException,
  InvalidVideoStatusException,
} from '../common/exceptions/domain.exception';
import { Video, VideoStatus } from './entities/video.entity';
import { VideosService } from './videos.service';

const createMockVideo = (overrides?: Partial<Video>): Video => ({
  id: 'video-id',
  channelId: 'channel-id',
  title: 'Test Video',
  status: VideoStatus.PENDING,
  statusMessage: null,
  fileKey: null,
  fileSize: null,
  thumbnailKey: null,
  duration: null,
  mimeType: null,
  metadata: null,
  uploadId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  channel: null as never,
  ...overrides,
});

describe('VideosService', () => {
  let service: VideosService;
  let repo: jest.Mocked<Repository<Video>>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        {
          provide: getRepositoryToken(Video),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(VideosService);
    repo = module.get(getRepositoryToken(Video));
  });

  describe('create', () => {
    it('should create a video in pending status', async () => {
      const video = createMockVideo();
      repo.create.mockReturnValue(video);
      repo.save.mockResolvedValue(video);

      const result = await service.create(
        'channel-id',
        'Test Video',
        'video/mp4',
        1000,
      );

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'channel-id',
          title: 'Test Video',
          status: VideoStatus.PENDING,
        }),
      );
      expect(result.status).toBe(VideoStatus.PENDING);
    });
  });

  describe('findById', () => {
    it('should return video when found', async () => {
      const video = createMockVideo();
      repo.findOne.mockResolvedValue(video);

      const result = await service.findById('video-id');
      expect(result.id).toBe('video-id');
    });

    it('should throw NotFoundException when not found', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.findById('invalid-id')).rejects.toThrow(
        VideoNotFoundException,
      );
    });
  });

  describe('updateStatus', () => {
    it('should update status', async () => {
      const video = createMockVideo();
      repo.findOne.mockResolvedValue(video);
      repo.save.mockResolvedValue({ ...video, status: VideoStatus.READY });

      const result = await service.updateStatus('video-id', VideoStatus.READY);
      expect(result.status).toBe(VideoStatus.READY);
    });
  });

  describe('markAsError', () => {
    it('should set error status with message', async () => {
      repo.findOne.mockResolvedValue(createMockVideo());
      repo.save.mockImplementation((v) => Promise.resolve(v as Video));

      const result = await service.markAsError('video-id', 'Failed');
      expect(result.status).toBe(VideoStatus.ERROR);
      expect(result.statusMessage).toBe('Failed');
    });
  });

  describe('assertStatus', () => {
    it('should not throw when status is allowed', () => {
      const video = createMockVideo();
      expect(() =>
        service.assertStatus(video, [VideoStatus.PENDING]),
      ).not.toThrow();
    });

    it('should throw when status is not allowed', () => {
      const video = createMockVideo();
      expect(() => service.assertStatus(video, [VideoStatus.READY])).toThrow(
        InvalidVideoStatusException,
      );
    });
  });

  describe('ensureOwnership', () => {
    it('should throw when channel does not match', async () => {
      const video = createMockVideo();
      repo.findOne.mockResolvedValue(video);

      await expect(
        service.ensureOwnership('video-id', 'wrong-channel'),
      ).rejects.toThrow(VideoNotFoundException);
    });

    it('should return video when channel matches', async () => {
      const video = createMockVideo();
      repo.findOne.mockResolvedValue(video);

      const result = await service.ensureOwnership('video-id', 'channel-id');
      expect(result.id).toBe('video-id');
    });
  });
});
