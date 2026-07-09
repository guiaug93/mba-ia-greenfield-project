import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Channel } from './entities/channel.entity';
import { ChannelsService } from './channels.service';

describe('ChannelsModule', () => {
  it('should compile with ChannelsService', async () => {
    const module = await Test.createTestingModule({
      providers: [
        ChannelsService,
        { provide: getRepositoryToken(Channel), useValue: {} },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
      ],
    }).compile();

    expect(module).toBeDefined();
    const service = module.get(ChannelsService);
    expect(service).toBeDefined();
    await module.close();
  });
});
