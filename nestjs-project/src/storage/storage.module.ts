import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import storageConfig from '../config/storage.config';
import { S3_CLIENT } from './storage.constants';
import { StorageService } from './storage.service';
import { BucketsService } from './buckets.service';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: S3_CLIENT,
      inject: [storageConfig.KEY],
      useFactory: (config: ConfigType<typeof storageConfig>) => {
        return new S3Client({
          endpoint: `http://${config.endpoint}:${config.port}`,
          region: 'us-east-1',
          credentials: {
            accessKeyId: config.accessKey,
            secretAccessKey: config.secretKey,
          },
          forcePathStyle: true,
        });
      },
    },
    StorageService,
    BucketsService,
  ],
  exports: [S3_CLIENT, StorageService, BucketsService],
})
export class StorageModule {}
