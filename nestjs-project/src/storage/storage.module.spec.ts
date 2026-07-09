import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { S3_CLIENT } from './storage.constants';
import { StorageModule } from './storage.module';

describe('StorageModule', () => {
  it('should compile and provide S3_CLIENT', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig],
        }),
        StorageModule,
      ],
    })
      .overrideProvider(S3_CLIENT)
      .useValue({})
      .compile();

    expect(module).toBeDefined();
    expect(module.get(S3_CLIENT)).toBeDefined();
    await module.close();
  });
});
