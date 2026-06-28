import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  CreateBucketCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { StorageService } from './storage.service';
import { S3_CLIENT } from './storage.constants';

const TEST_BUCKET = 'test-videos';

describe('StorageService (integration)', () => {
  let service: StorageService;
  let s3Client: S3Client;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig],
        }),
      ],
      providers: [
        StorageService,
        {
          provide: S3_CLIENT,
          inject: [storageConfig.KEY],
          useFactory: (config: any) =>
            new S3Client({
              endpoint: `http://${config.endpoint}:${config.port}`,
              region: 'us-east-1',
              credentials: {
                accessKeyId: config.accessKey,
                secretAccessKey: config.secretKey,
              },
              forcePathStyle: true,
            }),
        },
      ],
    }).compile();

    service = module.get(StorageService);
    s3Client = module.get(S3_CLIENT);

    try {
      await s3Client.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }));
    } catch {
      // bucket already exists
    }
  });

  afterAll(async () => {
    try {
      const listed = await s3Client.send(
        new ListObjectsV2Command({ Bucket: TEST_BUCKET }),
      );
      if (listed.Contents) {
        await Promise.all(
          listed.Contents.map((obj) =>
            s3Client.send(
              new DeleteObjectCommand({ Bucket: TEST_BUCKET, Key: obj.Key }),
            ),
          ),
        );
      }
    } catch {
      // ignore cleanup errors
    }
  });

  describe('single file upload and download', () => {
    const key = 'test/single-file.txt';
    const content = Buffer.from('Hello MinIO!');

    it('should upload a file', async () => {
      await service.uploadFile(TEST_BUCKET, key, content);

      const command = new HeadObjectCommand({ Bucket: TEST_BUCKET, Key: key });
      const result = await s3Client.send(command);
      expect(result.ContentLength).toBeGreaterThan(0);
      expect(result.ContentType).toBe('application/octet-stream');
    });

    it('should download a file', async () => {
      const destPath = join(tmpdir(), 'test-download.txt');
      await service.downloadToFile(TEST_BUCKET, key, destPath);

      const downloaded = readFileSync(destPath);
      expect(downloaded.toString()).toBe('Hello MinIO!');
      unlinkSync(destPath);
    });
  });

  describe('multipart upload lifecycle', () => {
    const key = 'test/multipart.txt';

    it('should complete full multipart lifecycle', async () => {
      const { uploadId, fileKey } = await service.initMultipartUpload(
        TEST_BUCKET,
        key,
        'text/plain',
      );
      expect(uploadId).toBeDefined();
      expect(fileKey).toBe(key);

      const urls = await service.generatePresignedPartUrls(
        TEST_BUCKET,
        key,
        uploadId,
        1,
      );
      expect(urls.parts).toHaveLength(1);
      expect(urls.partSize).toBe(50 * 1024 * 1024);
      expect(urls.parts[0].url).toContain(TEST_BUCKET);

      const uploadResult = await s3Client.send(
        new UploadPartCommand({
          Bucket: TEST_BUCKET,
          Key: key,
          UploadId: uploadId,
          PartNumber: 1,
          Body: Buffer.from('multipart content'),
        }),
      );

      await expect(
        service.completeMultipartUpload(TEST_BUCKET, key, uploadId, [
          { partNumber: 1, etag: uploadResult.ETag! },
        ]),
      ).resolves.toBeUndefined();

      const command = new HeadObjectCommand({ Bucket: TEST_BUCKET, Key: key });
      const result = await s3Client.send(command);
      expect(result.ContentLength).toBeGreaterThan(0);
    });

    it('should abort multipart upload', async () => {
      const { uploadId } = await service.initMultipartUpload(
        TEST_BUCKET,
        'test/abort-me.txt',
        'text/plain',
      );

      await expect(
        service.abortMultipartUpload(
          TEST_BUCKET,
          'test/abort-me.txt',
          uploadId,
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('getObjectMetadata', () => {
    it('should return metadata for existing object', async () => {
      const key = 'test/metadata-check.txt';
      await service.uploadFile(TEST_BUCKET, key, Buffer.from('metadata test'));

      const result = await service.getObjectMetadata(TEST_BUCKET, key);
      expect(result.contentLength).toBe(13);
      expect(result.contentType).toBe('application/octet-stream');
    });
  });

  describe('generatePresignedGetUrl', () => {
    it('should generate a valid presigned URL', async () => {
      const key = 'test/presigned-get.txt';
      await service.uploadFile(
        TEST_BUCKET,
        key,
        Buffer.from('presigned content'),
      );

      const url = await service.generatePresignedGetUrl(TEST_BUCKET, key, 60);
      expect(url).toContain(TEST_BUCKET);
      expect(url).toContain(key);

      const response = await fetch(url);
      expect(response.ok).toBe(true);
      const text = await response.text();
      expect(text).toBe('presigned content');
    });
  });
});
