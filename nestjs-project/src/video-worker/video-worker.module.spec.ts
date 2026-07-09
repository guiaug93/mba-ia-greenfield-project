import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import appConfig from '../config/app.config';
import databaseConfig from '../config/database.config';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import authConfig from '../config/auth.config';
import mailConfig from '../config/mail.config';
import { Video } from '../videos/entities/video.entity';
import { S3_CLIENT } from '../storage/storage.constants';
import { VideoProcessor } from './video.processor';
import { VideoWorkerModule } from './video-worker.module';

describe('VideoWorkerModule', () => {
  it('should compile successfully', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            appConfig,
            authConfig,
            databaseConfig,
            mailConfig,
            queueConfig,
            storageConfig,
          ],
        }),
        BullModule.forRoot({
          connection: { host: 'localhost', port: 6379 },
        }),
        VideoWorkerModule,
      ],
    })
      .overrideProvider(DataSource)
      .useValue({
        getRepository: jest.fn().mockReturnValue({
          find: jest.fn().mockResolvedValue([]),
          findOne: jest.fn().mockResolvedValue(null),
          save: jest.fn().mockResolvedValue({}),
          create: jest.fn().mockReturnValue({}),
        }),
        createQueryRunner: jest.fn().mockReturnValue({
          connect: jest.fn(),
          startTransaction: jest.fn(),
          commitTransaction: jest.fn(),
          rollbackTransaction: jest.fn(),
          release: jest.fn(),
          manager: { save: jest.fn() },
        }),
        destroy: jest.fn(),
        isInitialized: true,
        options: { entities: [Video] },
      })
      .overrideProvider(getRepositoryToken(Video))
      .useValue({})
      .overrideProvider(S3_CLIENT)
      .useValue({})
      .compile();

    expect(module).toBeDefined();
    const processor = module.get(VideoProcessor);
    expect(processor).toBeDefined();
    await module.close();
  }, 30000);
});
