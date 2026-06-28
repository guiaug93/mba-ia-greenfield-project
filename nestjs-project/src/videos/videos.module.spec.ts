import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Video } from './entities/video.entity';
import { VideosService } from './videos.service';

describe('VideosModule', () => {
  it('should compile successfully', async () => {
    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: {} },
      ],
    }).compile();

    expect(module).toBeDefined();
    const videosService = module.get(VideosService);
    expect(videosService).toBeDefined();
    await module.close();
  });
});
