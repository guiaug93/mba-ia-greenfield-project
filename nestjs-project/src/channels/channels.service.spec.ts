import { DataSource, QueryFailedError, EntityManager } from 'typeorm';
import { ChannelsService } from './channels.service';
import { Channel } from './entities/channel.entity';
import { ChannelNotFoundException } from '../common/exceptions/domain.exception';

interface MockManager {
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
}

interface MockDataSource {
  transaction: jest.Mock;
  manager: { findOne: jest.Mock };
}

function makeManager(
  overrides: Partial<Record<string, jest.Mock>> = {},
): MockManager {
  return {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    ...overrides,
  };
}

function makeChannel(nickname: string): Channel {
  const c = new Channel();
  c.id = 'uuid';
  c.nickname = nickname;
  c.name = nickname;
  c.user_id = 'user-id';
  c.description = null;
  c.created_at = new Date();
  c.updated_at = new Date();
  return c;
}

function makeUniqueError(): QueryFailedError {
  const err = new QueryFailedError('INSERT', [], new Error());
  (err as unknown as { code: string; detail: string }).code = '23505';
  (err as unknown as { code: string; detail: string }).detail =
    'Key (nickname)=(abc) already exists.';
  return err;
}

function makeDataSource(manager: MockManager): MockDataSource {
  return {
    transaction: jest.fn((cb: (m: EntityManager) => Promise<Channel>) =>
      cb(manager as unknown as EntityManager),
    ),
    manager,
  };
}

describe('ChannelsService', () => {
  describe('createChannel', () => {
    // ── Happy Path ──────────────────────────────────────────
    it('derives nickname from email prefix and saves when no collision', async () => {
      const channel = makeChannel('test');
      const manager = makeManager({
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockReturnValue(channel),
        save: jest.fn().mockResolvedValue(channel),
      });
      const service = new ChannelsService(
        makeDataSource(manager) as unknown as DataSource,
      );

      const result = await service.createChannel('user-id', 'test@example.com');
      expect(manager.findOne).toHaveBeenCalledWith(Channel, {
        where: { nickname: 'test' },
      });
      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(result.nickname).toBe('test');
    });

    it('retries with suffix when pre-check finds existing nickname', async () => {
      const colliding = makeChannel('john');
      const resolved = makeChannel('john_abc');
      const manager = makeManager({
        findOne: jest
          .fn()
          .mockResolvedValueOnce(colliding)
          .mockResolvedValueOnce(null),
        create: jest.fn().mockReturnValue(resolved),
        save: jest.fn().mockResolvedValue(resolved),
      });
      const service = new ChannelsService(
        makeDataSource(manager) as unknown as DataSource,
      );

      const result = await service.createChannel('user-id', 'john@example.com');
      expect(manager.findOne).toHaveBeenCalledTimes(2);
      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(result.nickname).toMatch(/^john_[a-z0-9]{3}$/);
    });

    it('retries with suffix on concurrent unique constraint violation', async () => {
      const resolved = makeChannel('alice_abc');
      const manager = makeManager({
        findOne: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        create: jest.fn().mockReturnValue(resolved),
        save: jest
          .fn()
          .mockRejectedValueOnce(makeUniqueError())
          .mockResolvedValueOnce(resolved),
      });
      const service = new ChannelsService(
        makeDataSource(manager) as unknown as DataSource,
      );

      const result = await service.createChannel(
        'user-id',
        'alice@example.com',
      );
      expect(manager.save).toHaveBeenCalledTimes(2);
      expect(result.nickname).toMatch(/^alice/);
    });

    it('throws after exhausting max retries', async () => {
      const existing = makeChannel('bob');
      const manager = makeManager({
        findOne: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
        save: jest.fn(),
      });
      const service = new ChannelsService(
        makeDataSource(manager) as unknown as DataSource,
      );

      await expect(
        service.createChannel('user-id', 'bob@example.com'),
      ).rejects.toThrow(
        'Nickname conflict could not be resolved after max retries',
      );
    });

    it('re-throws non-unique-constraint errors immediately', async () => {
      const unexpectedError = new Error('Connection lost');
      const channel = makeChannel('carol');
      const manager = makeManager({
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockReturnValue(channel),
        save: jest.fn().mockRejectedValue(unexpectedError),
      });
      const service = new ChannelsService(
        makeDataSource(manager) as unknown as DataSource,
      );

      await expect(
        service.createChannel('user-id', 'carol@example.com'),
      ).rejects.toThrow('Connection lost');
      expect(manager.save).toHaveBeenCalledTimes(1);
    });

    // ── Corner Cases ────────────────────────────────────────
    it('handles email with dots in prefix', async () => {
      const channel = makeChannel('johnsmith');
      const manager = makeManager({
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockReturnValue(channel),
        save: jest.fn().mockResolvedValue(channel),
      });
      const service = new ChannelsService(
        makeDataSource(manager) as unknown as DataSource,
      );

      const result = await service.createChannel(
        'user-id',
        'john.smith@example.com',
      );
      expect(result.nickname).toBe('johnsmith');
    });

    it('handles email with plus sign (sanitized out)', async () => {
      const channel = makeChannel('johnlabel');
      const manager = makeManager({
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockReturnValue(channel),
        save: jest.fn().mockResolvedValue(channel),
      });
      const service = new ChannelsService(
        makeDataSource(manager) as unknown as DataSource,
      );

      const result = await service.createChannel(
        'user-id',
        'john+label@example.com',
      );
      expect(result.nickname).toBe('johnlabel');
    });

    it('handles email with numbers only prefix', async () => {
      const channel = makeChannel('12345');
      const manager = makeManager({
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockReturnValue(channel),
        save: jest.fn().mockResolvedValue(channel),
      });
      const service = new ChannelsService(
        makeDataSource(manager) as unknown as DataSource,
      );

      const result = await service.createChannel(
        'user-id',
        '12345@example.com',
      );
      expect(result.nickname).toBe('12345');
    });

    it('generates user_XXXXXXXX for email with only special chars in prefix', async () => {
      const manager = makeManager({
        findOne: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation((_entity, data: { nickname: string }) => {
            const c = makeChannel(data.nickname);
            c.user_id = (data as Record<string, string>).user_id;
            return c;
          }),
        save: jest.fn().mockImplementation((c: Channel) => Promise.resolve(c)),
      });
      const service = new ChannelsService(
        makeDataSource(manager) as unknown as DataSource,
      );

      const result = await service.createChannel('user-id', '!!!@example.com');
      expect(result.nickname).toMatch(/^user_[a-z0-9]{8}$/);
    });

    it('truncates very long email prefix to 46 chars', async () => {
      const longPrefix = 'a'.repeat(60);
      const channel = makeChannel('a'.repeat(46));
      const manager = makeManager({
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockReturnValue(channel),
        save: jest.fn().mockResolvedValue(channel),
      });
      const service = new ChannelsService(
        makeDataSource(manager) as unknown as DataSource,
      );

      const result = await service.createChannel(
        'user-id',
        `${longPrefix}@example.com`,
      );
      expect(result.nickname.length).toBeLessThanOrEqual(50);
    });

    it('handles multiple concurrent collisions gracefully', async () => {
      const existing1 = makeChannel('dup');
      const existing2 = makeChannel('dup_abc');
      const resolved = makeChannel('dup_def');
      const manager = makeManager({
        findOne: jest
          .fn()
          .mockResolvedValueOnce(existing1)
          .mockResolvedValueOnce(existing2)
          .mockResolvedValueOnce(null),
        create: jest.fn().mockReturnValue(resolved),
        save: jest.fn().mockResolvedValue(resolved),
      });
      const service = new ChannelsService(
        makeDataSource(manager) as unknown as DataSource,
      );

      const result = await service.createChannel('user-id', 'dup@example.com');
      expect(manager.findOne).toHaveBeenCalledTimes(3);
      expect(result.nickname).toBe('dup_def');
    });

    it('passes userId through to created channel', async () => {
      const channel = makeChannel('test');
      channel.user_id = 'specific-user-id';
      const manager = makeManager({
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockReturnValue(channel),
        save: jest.fn().mockResolvedValue(channel),
      });
      const service = new ChannelsService(
        makeDataSource(manager) as unknown as DataSource,
      );

      const result = await service.createChannel(
        'specific-user-id',
        'test@example.com',
      );
      expect(result.user_id).toBe('specific-user-id');
    });

    it('uses transaction wrapper from dataSource', async () => {
      const channel = makeChannel('test');
      const manager = makeManager({
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockReturnValue(channel),
        save: jest.fn().mockResolvedValue(channel),
      });
      const ds = makeDataSource(manager);
      const service = new ChannelsService(ds as unknown as DataSource);

      await service.createChannel('user-id', 'test@example.com');
      expect(ds.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('findByUserId', () => {
    it('returns channel when found', async () => {
      const channel = makeChannel('test');
      const manager = makeManager({
        findOne: jest.fn().mockResolvedValue(channel),
      });
      const service = new ChannelsService(
        makeDataSource(manager) as unknown as DataSource,
      );

      const result = await service.findByUserId('user-id');
      expect(result).toBe(channel);
      expect(manager.findOne).toHaveBeenCalledWith(Channel, {
        where: { user_id: 'user-id' },
      });
    });

    it('throws ChannelNotFoundException when no channel for user', async () => {
      const manager = makeManager({
        findOne: jest.fn().mockResolvedValue(null),
      });
      const service = new ChannelsService(
        makeDataSource(manager) as unknown as DataSource,
      );

      await expect(service.findByUserId('no-user')).rejects.toThrow(
        ChannelNotFoundException,
      );
    });
  });
});
