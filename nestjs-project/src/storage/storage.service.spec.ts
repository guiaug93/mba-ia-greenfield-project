import { Test } from '@nestjs/testing';
import { StorageService } from './storage.service';
import { S3_CLIENT } from './storage.constants';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('http://presigned.url'),
}));

type MockS3Client = { send: jest.Mock };

const createMockS3Client = (): MockS3Client => ({
  send: jest.fn(),
});

describe('StorageService', () => {
  let service: StorageService;
  let s3Client: MockS3Client;

  beforeEach(async () => {
    s3Client = createMockS3Client();
    const module = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: S3_CLIENT,
          useValue: s3Client,
        },
      ],
    }).compile();

    service = module.get(StorageService);
  });

  describe('initMultipartUpload', () => {
    it('should return uploadId and fileKey', async () => {
      s3Client.send.mockResolvedValue({ UploadId: 'upload-123' });

      const result = await service.initMultipartUpload(
        'videos',
        'test-key',
        'video/mp4',
      );

      expect(result.uploadId).toBe('upload-123');
      expect(result.fileKey).toBe('test-key');
    });
  });

  describe('completeMultipartUpload', () => {
    it('should complete without error', async () => {
      s3Client.send.mockResolvedValue({});

      await expect(
        service.completeMultipartUpload('videos', 'key', 'upload-123', [
          { partNumber: 1, etag: 'etag1' },
        ]),
      ).resolves.toBeUndefined();
    });
  });

  describe('abortMultipartUpload', () => {
    it('should abort without error', async () => {
      s3Client.send.mockResolvedValue({});

      await expect(
        service.abortMultipartUpload('videos', 'key', 'upload-123'),
      ).resolves.toBeUndefined();
    });
  });

  describe('getObjectMetadata', () => {
    it('should return content length and type', async () => {
      s3Client.send.mockResolvedValue({
        ContentLength: 1000,
        ContentType: 'video/mp4',
      });

      const result = await service.getObjectMetadata('videos', 'key');
      expect(result.contentLength).toBe(1000);
      expect(result.contentType).toBe('video/mp4');
    });
  });

  describe('generatePresignedPartUrls', () => {
    it('should generate URLs for each part', async () => {
      const result = await service.generatePresignedPartUrls(
        'videos',
        'key',
        'upload-123',
        3,
      );

      expect(result.parts).toHaveLength(3);
      expect(result.partSize).toBe(50 * 1024 * 1024);
    });
  });
});
