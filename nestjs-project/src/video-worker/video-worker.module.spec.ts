import { Test } from '@nestjs/testing';
import { VideosService } from '../videos/videos.service';
import { StorageService } from '../storage/storage.service';
import { VideoProcessor } from './video.processor';

describe('VideoWorkerModule', () => {
  it('should compile VideoProcessor successfully', async () => {
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

    expect(module).toBeDefined();
    const processor = module.get(VideoProcessor);
    expect(processor).toBeDefined();
    await module.close();
  }, 30000);
});
