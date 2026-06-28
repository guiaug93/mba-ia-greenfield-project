import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import type { ConfigType } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { S3_CLIENT } from './storage.constants';

@Injectable()
export class BucketsService implements OnApplicationBootstrap {
  constructor(
    @Inject(S3_CLIENT) private readonly s3Client: S3Client,
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureBucket(this.config.bucketVideos);
    await this.ensureBucket(this.config.bucketThumbnails);
  }

  private async ensureBucket(bucket: string): Promise<void> {
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await this.s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  }
}
