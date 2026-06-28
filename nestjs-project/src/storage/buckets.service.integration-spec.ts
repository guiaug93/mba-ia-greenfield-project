import {
  S3Client,
  HeadBucketCommand,
  ListBucketsCommand,
} from '@aws-sdk/client-s3';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { S3_CLIENT } from './storage.constants';
import { BucketsService } from './buckets.service';

describe('BucketsService (integration)', () => {
  let service: BucketsService;
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
        BucketsService,
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

    service = module.get(BucketsService);
    s3Client = module.get(S3_CLIENT);
  });

  it('should create videos and thumbnails buckets on bootstrap', async () => {
    await service.onApplicationBootstrap();

    const listed = await s3Client.send(new ListBucketsCommand({}));
    const bucketNames = listed.Buckets?.map((b) => b.Name) || [];

    expect(bucketNames).toContain('videos');
    expect(bucketNames).toContain('thumbnails');
  });

  it('should not throw when buckets already exist', async () => {
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('should allow head on created buckets', async () => {
    await s3Client.send(new HeadBucketCommand({ Bucket: 'videos' }));
    await s3Client.send(new HeadBucketCommand({ Bucket: 'thumbnails' }));
  });
});
