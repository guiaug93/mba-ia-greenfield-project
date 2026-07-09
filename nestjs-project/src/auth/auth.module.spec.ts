import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import authConfig from '../config/auth.config';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { VerificationToken } from './entities/verification-token.entity';

describe('AuthModule', () => {
  it('should compile AuthService successfully', async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: {} },
        { provide: MailService, useValue: {} },
        { provide: JwtService, useValue: {} },
        {
          provide: getRepositoryToken(VerificationToken),
          useValue: {},
        },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: {},
        },
        { provide: authConfig.KEY, useValue: {} },
      ],
    }).compile();

    expect(module).toBeDefined();
    const service = module.get(AuthService);
    expect(service).toBeDefined();
    await module.close();
  });
});
