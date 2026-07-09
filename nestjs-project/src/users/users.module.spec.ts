import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChannelsService } from '../channels/channels.service';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

describe('UsersModule', () => {
  it('should compile UsersService successfully', async () => {
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: {} },
        { provide: ChannelsService, useValue: {} },
      ],
    }).compile();

    expect(module).toBeDefined();
    const service = module.get(UsersService);
    expect(service).toBeDefined();
    await module.close();
  });
});
