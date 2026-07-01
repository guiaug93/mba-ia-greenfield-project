import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { MailService } from '../src/mail/mail.service';
import { VideoStatus } from '../src/videos/entities/video.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */

const TEST_PASSWORD = 'Test123!@#';
let testCounter = 0;

describe('Videos (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  const createUserAndChannel = async (): Promise<{
    token: string;
    userId: string;
  }> => {
    const email = `e2e-video-${Date.now()}-${testCounter++}@test.com`;
    const signupRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: TEST_PASSWORD });
    expect(signupRes.status).toBe(201);

    await dataSource.query(
      `UPDATE users SET is_confirmed = TRUE WHERE email = $1`,
      [email],
    );

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: TEST_PASSWORD });
    expect(loginRes.status).toBe(200);
    const token = loginRes.body.access_token;

    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString(),
    );
    const userId = payload.sub;

    return { token, userId };
  };

  const createVideo = async (token: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Test Video', mimeType: 'video/mp4', fileSize: 5000 });
    expect(res.status).toBe(201);
    return res.body.id;
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailService)
      .useValue({
        sendConfirmationEmail: jest.fn(),
        sendPasswordResetEmail: jest.fn(),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();

    dataSource = moduleFixture.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  describe('POST /videos', () => {
    it('should create a video in pending status', async () => {
      const { token } = await createUserAndChannel();

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Test Video E2E',
          mimeType: 'video/mp4',
          fileSize: 1000,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe(VideoStatus.PENDING);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request(app.getHttpServer()).post('/videos').send({
        title: 'Unauthenticated Video',
        mimeType: 'video/mp4',
        fileSize: 1000,
      });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /videos/:id/upload-urls', () => {
    it('should return presigned URLs for upload', async () => {
      const { token } = await createUserAndChannel();
      const videoId = await createVideo(token);

      // Init upload first to set uploadId and fileKey
      const initRes = await request(app.getHttpServer())
        .post(`/videos/${videoId}/init-upload`)
        .set('Authorization', `Bearer ${token}`);
      expect(initRes.status).toBe(201);

      const res = await request(app.getHttpServer())
        .get(`/videos/${videoId}/upload-urls?partCount=2`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.parts).toHaveLength(2);
      expect(res.body.partSize).toBe(50 * 1024 * 1024);
      res.body.parts.forEach((part: { partNumber: number; url: string }) => {
        expect(part.partNumber).toBeGreaterThan(0);
        expect(part.url).toContain('videos');
      });
    });
  });

  describe('POST /videos/:id/complete', () => {
    it('should transition video to processing after complete', async () => {
      const { token } = await createUserAndChannel();
      const videoId = await createVideo(token);

      // Init multipart
      const initRes = await request(app.getHttpServer())
        .post(`/videos/${videoId}/init-upload`)
        .set('Authorization', `Bearer ${token}`);
      expect(initRes.status).toBe(201);

      // Get presigned URL
      const urlsRes = await request(app.getHttpServer())
        .get(`/videos/${videoId}/upload-urls?partCount=1`)
        .set('Authorization', `Bearer ${token}`);
      expect(urlsRes.status).toBe(200);

      const presignedUrl = urlsRes.body.parts[0].url;

      const uploadRes = await fetch(presignedUrl, {
        method: 'PUT',
        body: Buffer.from('fake video content for e2e test'),
      });
      expect(uploadRes.ok).toBe(true);

      const completeRes = await request(app.getHttpServer())
        .post(`/videos/${videoId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          parts: [
            {
              partNumber: 1,
              etag: uploadRes.headers.get('etag')?.replace(/"/g, ''),
            },
          ],
        });

      // POST returns 201 (Created) by default in NestJS
      expect(completeRes.status).toBe(201);
      expect(completeRes.body.status).toBe(VideoStatus.PROCESSING);
    });
  });

  describe('GET /videos/:id', () => {
    it('should return video metadata for an existing video', async () => {
      const { token } = await createUserAndChannel();
      const videoId = await createVideo(token);

      const res = await request(app.getHttpServer()).get(`/videos/${videoId}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(videoId);
      expect(res.body.title).toBe('Test Video');
      expect(res.body.status).toBe(VideoStatus.PENDING);
    });

    it('should return 404 for non-existent video', async () => {
      const res = await request(app.getHttpServer()).get(
        '/videos/00000000-0000-0000-0000-000000000000',
      );

      expect(res.status).toBe(404);
    });
  });

  describe('GET /videos/:id/stream', () => {
    it('should not stream non-ready video (returns 409)', async () => {
      const { token } = await createUserAndChannel();
      const videoId = await createVideo(token);

      const res = await request(app.getHttpServer()).get(
        `/videos/${videoId}/stream`,
      );

      expect(res.status).toBe(409);
    });
  });

  describe('GET /videos/:id/thumbnail', () => {
    it('should return null thumbnail url when not set', async () => {
      const { token } = await createUserAndChannel();
      const videoId = await createVideo(token);

      const res = await request(app.getHttpServer()).get(
        `/videos/${videoId}/thumbnail`,
      );

      expect(res.status).toBe(200);
      expect(res.body.thumbnailUrl).toBeNull();
    });
  });
});
