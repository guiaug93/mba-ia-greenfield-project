/* eslint-disable @typescript-eslint/unbound-method */
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

  // ── CREATE ──────────────────────────────────────────────
  describe('create', () => {
    it('creates a video in pending status with all fields', async () => {
      const video = createMockVideo({
        title: 'My Video',
        mimeType: 'video/mp4',
        fileSize: 5000,
      });
      repo.create.mockReturnValue(video);
      repo.save.mockResolvedValue(video);

      const result = await service.create(
        'ch-1',
        'My Video',
        'video/mp4',
        5000,
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'ch-1',
          title: 'My Video',
          status: VideoStatus.PENDING,
        }),
      );
      expect(result.status).toBe(VideoStatus.PENDING);
      expect(result.title).toBe('My Video');
    });

    it('accepts null mimeType and fileSize', async () => {
      const video = createMockVideo({ mimeType: null, fileSize: null });
      repo.create.mockReturnValue(video);
      repo.save.mockResolvedValue(video);

      const result = await service.create('ch-1', 'No Meta');

      expect(result.mimeType).toBeNull();
      expect(result.fileSize).toBeNull();
    });

    it('accepts undefined mimeType', async () => {
      const video = createMockVideo({ mimeType: null });
      repo.create.mockReturnValue(video);
      repo.save.mockResolvedValue(video);

      const result = await service.create('ch-1', 'Undef mime', undefined);
      expect(result.mimeType).toBeNull();
    });

    it('accepts zero as fileSize', async () => {
      const video = createMockVideo({ fileSize: 0 });
      repo.create.mockReturnValue(video);
      repo.save.mockResolvedValue(video);

      const result = await service.create('ch-1', 'Zero Size', undefined, 0);
      expect(result.fileSize).toBe(0);
    });

    it('accepts title with 255 characters', async () => {
      const longTitle = 'a'.repeat(255);
      const video = createMockVideo({ title: longTitle });
      repo.create.mockReturnValue(video);
      repo.save.mockResolvedValue(video);

      const result = await service.create('ch-1', longTitle);
      expect(result.title).toHaveLength(255);
    });
  });

  // ── findById ────────────────────────────────────────────
  describe('findById', () => {
    it('returns video with channel relation loaded', async () => {
      const video = createMockVideo();
      repo.findOne.mockResolvedValue(video);

      const result = await service.findById('video-id');
      expect(result.id).toBe('video-id');
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'video-id' },
        relations: ['channel'],
      });
    });

    it('throws VideoNotFoundException for non-existent id', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findById('bad-id')).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('throws VideoNotFoundException for empty string id', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findById('')).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('throws VideoNotFoundException for null-like id', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.findById('00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(VideoNotFoundException);
    });
  });

  // ── findByChannel ───────────────────────────────────────
  describe('findByChannel', () => {
    it('returns videos sorted by createdAt DESC', async () => {
      const old = createMockVideo({
        id: 'old',
        createdAt: new Date('2020-01-01'),
      });
      const recent = createMockVideo({
        id: 'recent',
        createdAt: new Date('2025-01-01'),
      });
      repo.find.mockResolvedValue([recent, old]);

      const results = await service.findByChannel('ch-1');
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('recent');
      expect(results[1].id).toBe('old');
    });

    it('returns empty array for channel with no videos', async () => {
      repo.find.mockResolvedValue([]);
      const results = await service.findByChannel('ch-empty');
      expect(results).toEqual([]);
    });
  });

  // ── updateStatus ────────────────────────────────────────
  describe('updateStatus', () => {
    it.each([
      [VideoStatus.PENDING, VideoStatus.PROCESSING],
      [VideoStatus.PROCESSING, VideoStatus.READY],
      [VideoStatus.PROCESSING, VideoStatus.ERROR],
      [VideoStatus.READY, VideoStatus.ERROR],
      [VideoStatus.ERROR, VideoStatus.PENDING],
    ])('transitions from %s to %s', async (from, to) => {
      const video = createMockVideo({ status: from });
      repo.findOne.mockResolvedValue(video);
      repo.save.mockResolvedValue({ ...video, status: to });

      const result = await service.updateStatus('video-id', to);
      expect(result.status).toBe(to);
    });

    it('sets statusMessage when provided', async () => {
      const video = createMockVideo();
      repo.findOne.mockResolvedValue(video);
      repo.save.mockResolvedValue({
        ...video,
        status: VideoStatus.ERROR,
        statusMessage: 'Oops',
      });

      const result = await service.updateStatus(
        'video-id',
        VideoStatus.ERROR,
        'Oops',
      );
      expect(result.statusMessage).toBe('Oops');
    });

    it('sets empty statusMessage when empty string provided', async () => {
      const video = createMockVideo();
      repo.findOne.mockResolvedValue(video);
      repo.save.mockResolvedValue({ ...video, statusMessage: '' });

      const result = await service.updateStatus(
        'video-id',
        VideoStatus.ERROR,
        '',
      );
      expect(result.statusMessage).toBe('');
    });

    it('throws VideoNotFoundException when video not found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.updateStatus('bad-id', VideoStatus.READY),
      ).rejects.toThrow(VideoNotFoundException);
    });
  });

  // ── updateAfterProcessing ───────────────────────────────
  describe('updateAfterProcessing', () => {
    it('sets all processing fields and transition to READY', async () => {
      const video = createMockVideo({ status: VideoStatus.PROCESSING });
      repo.findOne.mockResolvedValue(video);
      repo.save.mockResolvedValue({
        ...video,
        status: VideoStatus.READY,
        duration: 120,
        metadata: { format: { duration: '120.0' } },
        thumbnailKey: 'thumbs/v-1/thumb.jpg',
        fileSize: 1048576,
      });

      const result = await service.updateAfterProcessing(
        'video-id',
        120,
        { format: { duration: '120.0' } },
        'thumbs/v-1/thumb.jpg',
        1048576,
      );

      expect(result.status).toBe(VideoStatus.READY);
      expect(result.duration).toBe(120);
      expect(result.thumbnailKey).toBe('thumbs/v-1/thumb.jpg');
      expect(result.fileSize).toBe(1048576);
    });

    it('handles duration of 0 (very short video)', async () => {
      const video = createMockVideo();
      repo.findOne.mockResolvedValue(video);
      repo.save.mockResolvedValue({
        ...video,
        duration: 0,
        status: VideoStatus.READY,
      });

      const result = await service.updateAfterProcessing(
        'video-id',
        0,
        {},
        'thumb.jpg',
        0,
      );
      expect(result.duration).toBe(0);
    });

    it('handles large fileSize values', async () => {
      const video = createMockVideo();
      repo.findOne.mockResolvedValue(video);
      repo.save.mockResolvedValue({
        ...video,
        fileSize: 10737418240,
        status: VideoStatus.READY,
      });

      const result = await service.updateAfterProcessing(
        'video-id',
        300,
        {},
        'thumb.jpg',
        10737418240,
      );
      expect(result.fileSize).toBe(10737418240);
    });

    it('throws VideoNotFoundException when video deleted mid-processing', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.updateAfterProcessing('bad-id', 0, {}, '', 0),
      ).rejects.toThrow(VideoNotFoundException);
    });
  });

  // ── markAsError ─────────────────────────────────────────
  describe('markAsError', () => {
    it('sets status to ERROR with message', async () => {
      repo.findOne.mockResolvedValue(createMockVideo());
      repo.save.mockImplementation((v) => Promise.resolve(v as Video));

      const result = await service.markAsError('video-id', 'FFprobe failed');
      expect(result.status).toBe(VideoStatus.ERROR);
      expect(result.statusMessage).toBe('FFprobe failed');
    });

    it('overwrites previous statusMessage', async () => {
      const video = createMockVideo({
        status: VideoStatus.PROCESSING,
        statusMessage: 'Old',
      });
      repo.findOne.mockResolvedValue(video);
      repo.save.mockImplementation((v) => Promise.resolve(v as Video));

      const result = await service.markAsError('video-id', 'New error');
      expect(result.statusMessage).toBe('New error');
    });

    it('throws VideoNotFoundException for non-existent video', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.markAsError('bad-id', 'msg')).rejects.toThrow(
        VideoNotFoundException,
      );
    });
  });

  // ── setUploadId ─────────────────────────────────────────
  describe('setUploadId', () => {
    it('sets uploadId and fileKey after multipart init', async () => {
      const video = createMockVideo();
      repo.findOne.mockResolvedValue(video);
      repo.save.mockResolvedValue({
        ...video,
        uploadId: 'upload-abc',
        fileKey: 'videos/v-1/master.mp4',
      });

      const result = await service.setUploadId(
        'video-id',
        'upload-abc',
        'videos/v-1/master.mp4',
      );
      expect(result.uploadId).toBe('upload-abc');
      expect(result.fileKey).toBe('videos/v-1/master.mp4');
    });

    it('overwrites previous uploadId and fileKey', async () => {
      const video = createMockVideo({
        uploadId: 'old-upload',
        fileKey: 'old-key',
      });
      repo.findOne.mockResolvedValue(video);
      repo.save.mockResolvedValue({
        ...video,
        uploadId: 'new-upload',
        fileKey: 'new-key',
      });

      const result = await service.setUploadId(
        'video-id',
        'new-upload',
        'new-key',
      );
      expect(result.uploadId).toBe('new-upload');
      expect(result.fileKey).toBe('new-key');
    });
  });

  // ── assertStatus ────────────────────────────────────────
  describe('assertStatus', () => {
    it('does not throw when status is in the allowed list', () => {
      const video = createMockVideo({ status: VideoStatus.PENDING });
      expect(() =>
        service.assertStatus(video, [
          VideoStatus.PENDING,
          VideoStatus.PROCESSING,
        ]),
      ).not.toThrow();
    });

    it('throws InvalidVideoStatusException when status not allowed', () => {
      const video = createMockVideo({ status: VideoStatus.PROCESSING });
      expect(() => service.assertStatus(video, [VideoStatus.PENDING])).toThrow(
        InvalidVideoStatusException,
      );
    });

    it('throws for empty allowed list', () => {
      const video = createMockVideo();
      expect(() => service.assertStatus(video, [])).toThrow(
        InvalidVideoStatusException,
      );
    });

    it('includes current status in error message', () => {
      const video = createMockVideo({ status: VideoStatus.PROCESSING });
      try {
        service.assertStatus(video, [VideoStatus.READY]);
        fail('Expected exception');
      } catch (e) {
        expect((e as Error).message).toContain(VideoStatus.PROCESSING);
      }
    });
  });

  // ── ensureOwnership ─────────────────────────────────────
  describe('ensureOwnership', () => {
    it('returns video when channel matches', async () => {
      const video = createMockVideo({ channelId: 'ch-a' });
      repo.findOne.mockResolvedValue(video);

      const result = await service.ensureOwnership('video-id', 'ch-a');
      expect(result.channelId).toBe('ch-a');
    });

    it('throws VideoNotFoundException when channel mismatch (hides existence)', async () => {
      const video = createMockVideo({ channelId: 'owner-x' });
      repo.findOne.mockResolvedValue(video);

      await expect(
        service.ensureOwnership('video-id', 'intruder-y'),
      ).rejects.toThrow(VideoNotFoundException);
    });

    it('throws VideoNotFoundException when video not found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.ensureOwnership('bad-id', 'any-channel'),
      ).rejects.toThrow(VideoNotFoundException);
    });
  });
});
