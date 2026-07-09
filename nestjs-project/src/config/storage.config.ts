import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000', 10),
  accessKey: process.env.MINIO_ACCESS_KEY || 'streamtube',
  secretKey: process.env.MINIO_SECRET_KEY || 'streamtube123',
  bucketVideos: process.env.MINIO_BUCKET_VIDEOS || 'videos',
  bucketThumbnails: process.env.MINIO_BUCKET_THUMBNAILS || 'thumbnails',
  useSsl: process.env.MINIO_USE_SSL === 'true',
}));
