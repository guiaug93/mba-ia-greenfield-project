import { DataSource, Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Video, VideoStatus } from './video.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideoEntity (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let channelRepository: Repository<Channel>;
  let userRepository: Repository<User>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
    channelRepository = dataSource.getRepository(Channel);
    userRepository = dataSource.getRepository(User);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  const createUser = async (): Promise<User> => {
    return userRepository.save(
      userRepository.create({
        email: 'test@example.com',
        password: 'hashed-password',
      } as User),
    );
  };

  const createChannel = async (user: User): Promise<Channel> => {
    return channelRepository.save(
      channelRepository.create({
        name: 'Test Channel',
        nickname: 'test-channel',
        user_id: user.id,
      } as Channel),
    );
  };

  it('should create a video with default pending status', async () => {
    const user = await createUser();
    const channel = await createChannel(user);

    const video = videoRepository.create({
      channelId: channel.id,
      title: 'My Video',
    });
    const saved = await videoRepository.save(video);

    expect(saved.id).toBeDefined();
    expect(saved.title).toBe('My Video');
    expect(saved.status).toBe(VideoStatus.PENDING);
    expect(saved.channelId).toBe(channel.id);
    expect(saved.createdAt).toBeDefined();
    expect(saved.updatedAt).toBeDefined();
  });

  it('should store all nullable fields correctly', async () => {
    const user = await createUser();
    const channel = await createChannel(user);

    const video = videoRepository.create({
      channelId: channel.id,
      title: 'Full Video',
      status: VideoStatus.READY,
      fileKey: 'videos/uuid/master.mp4',
      fileSize: 1048576000,
      thumbnailKey: 'thumbnails/uuid/thumbnail.jpg',
      duration: 596,
      mimeType: 'video/mp4',
      metadata: { width: 1920, height: 1080 },
    });
    const saved = await videoRepository.save(video);

    expect(saved.fileKey).toBe('videos/uuid/master.mp4');
    expect(saved.fileSize).toBe(1048576000);
    expect(saved.thumbnailKey).toBe('thumbnails/uuid/thumbnail.jpg');
    expect(saved.duration).toBe(596);
    expect(saved.mimeType).toBe('video/mp4');
    expect(saved.metadata).toEqual({ width: 1920, height: 1080 });
  });

  it('should enforce FK constraint to channels table', async () => {
    const video = videoRepository.create({
      channelId: '00000000-0000-0000-0000-000000000000',
      title: 'Orphan Video',
    });

    await expect(videoRepository.save(video)).rejects.toThrow();
  });

  it('should allow null values for optional fields', async () => {
    const user = await createUser();
    const channel = await createChannel(user);

    const video = videoRepository.create({
      channelId: channel.id,
      title: 'Minimal Video',
    });
    const saved = await videoRepository.save(video);

    expect(saved.statusMessage).toBeNull();
    expect(saved.fileKey).toBeNull();
    expect(saved.fileSize).toBeNull();
    expect(saved.thumbnailKey).toBeNull();
    expect(saved.duration).toBeNull();
    expect(saved.mimeType).toBeNull();
    expect(saved.metadata).toBeNull();
    expect(saved.uploadId).toBeNull();
  });
});
