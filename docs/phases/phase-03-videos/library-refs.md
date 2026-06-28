# Phase 03 — Upload e Processamento de Vídeos — Library References

> **Generated:** 2026-06-28  
> **Source:** Context7 MCP + npm registry + official docs  

---

## New npm Dependencies (nestjs-project)

| Package | Version | Purpose | Source |
|---------|---------|---------|--------|
| `@nestjs/bullmq` | `^11.0.4` | NestJS 11 BullMQ integration — queue registration, `@Processor`, `@InjectQueue` decorators | [npm](https://www.npmjs.com/package/@nestjs/bullmq) |
| `bullmq` | `^5.x` | BullMQ core — Queue, Worker, Job classes, Redis-backed job persistence | [docs.bullmq.io](https://docs.bullmq.io) |
| `@aws-sdk/client-s3` | `^3.x` | S3 SDK — `S3Client`, `GetObjectCommand`, `PutObjectCommand`, `CreateMultipartUploadCommand`, `UploadPartCommand`, `CompleteMultipartUploadCommand`, `AbortMultipartUploadCommand`, `HeadObjectCommand` | [docs.aws.amazon.com](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/) |
| `@aws-sdk/s3-request-presigner` | `^3.x` | Presigned URL generation — `getSignedUrl(client, command, { expiresIn })` for PUT and GET | [docs.aws.amazon.com](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-request-presigner/) |
| `@aws-sdk/lib-storage` | `^3.x` | High-level multipart upload helper — `Upload` class for streaming large files | [github.com/aws/aws-sdk-js-v3](https://github.com/aws/aws-sdk-js-v3/tree/main/lib/lib-storage) |

## No npm wrappers for FFmpeg

**Decision:** Use FFmpeg/ffprobe CLI directly via `child_process.execFile()` (Node.js built-in). No wrapper library needed.

- `fluent-ffmpeg` is **deprecated** (repo is readonly, no longer maintained per GitHub README)
- Alternatives (`ffmpeg-forge`, `mediaforge`) are too new and unproven for our needs
- Direct CLI calls are the simplest approach for two operations (metadata extraction + thumbnail generation)

## Docker Image Dependencies (video-worker)

| Dependency | How | 
|------------|-----|
| `ffmpeg` | `apk add ffmpeg` in `Dockerfile.worker` (Alpine) |
| `node` | Base image `node:22-alpine` |

## API Patterns

### BullMQ Setup (nestjs-project)

```typescript
// Module registration
BullModule.forRoot({
  connection: { host: 'redis', port: 6379 },
});
BullModule.registerQueue({ name: 'video-processing' });
```

```typescript
// Producer
@Injectable()
export class VideosService {
  constructor(@InjectQueue('video-processing') private queue: Queue) {}
  
  async enqueue(videoId: string) {
    await this.queue.add('process-video', { videoId }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }
}
```

```typescript
// Consumer (worker)
@Processor('video-processing')
export class VideoProcessor extends WorkerHost {
  async process(job: Job<{ videoId: string }>) {
    // download from MinIO → ffprobe → ffmpeg thumbnail → upload to MinIO → update DB
  }
}
```

### S3 Presigned URL Patterns

```typescript
// Generate presigned GET URL for streaming
const command = new GetObjectCommand({ Bucket: 'videos', Key: key });
const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
```

```typescript
// Generate presigned PUT URL for upload (files ≤ 5GB)
const command = new PutObjectCommand({ Bucket: 'videos', Key: key });
const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
```

```typescript
// Multipart upload - Create
const { UploadId } = await s3Client.send(
  new CreateMultipartUploadCommand({ Bucket: 'videos', Key: key })
);
```

```typescript
// Multipart upload - Generate presigned URL for each part
const command = new UploadPartCommand({ Bucket, Key, PartNumber, UploadId });
const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
```

```typescript
// Streaming with Range header
const { Body, ContentLength } = await s3Client.send(
  new GetObjectCommand({ Bucket: 'videos', Key: key, Range: 'bytes=0-1048575' })
);
// Body is a Readable stream
```

### FFprobe Metadata Extraction (worker)

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function getMetadata(filePath: string) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  return JSON.parse(stdout);
}
```

### FFmpeg Thumbnail Generation (worker)

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function generateThumbnail(inputPath: string, outputPath: string, timestamp: string = '00:00:05') {
  await execFileAsync('ffmpeg', [
    '-ss', timestamp,
    '-i', inputPath,
    '-vframes', '1',
    '-s', '1280x720',
    outputPath,
  ]);
}
```

## Version Constraints

- Node.js: >= 22 (worker Docker image)
- FFmpeg: >= 6 (Alpine 3.20+ ships FFmpeg 6.x)
- Redis: >= 7 (BullMQ 5.x requires Redis >= 6.2)

## References

- BullMQ NestJS guide: https://docs.bullmq.io/guide/nestjs
- NestJS Queues docs: https://docs.nestjs.com/techniques/queues
- AWS SDK S3 v3 docs: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/
- S3 presigner docs: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-request-presigner/
- FFmpeg docs: https://ffmpeg.org/documentation.html
- FFprobe docs: https://ffmpeg.org/ffprobe.html
