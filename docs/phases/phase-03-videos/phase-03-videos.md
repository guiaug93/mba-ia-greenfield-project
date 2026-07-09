# Phase 03 — Upload e Processamento de Vídeos

## Objective

Deliver video upload (up to 10GB) with async processing, streaming, and download — backed by MinIO object storage, BullMQ job queue with Redis, and a dedicated FFmpeg worker container.

---

## Step Implementations

### SI-03.1 — Nova Infraestrutura no Docker Compose

**Description:** Add MinIO (object storage), Redis (BullMQ backend), and video-worker (FFmpeg) containers to `compose.yaml`. Install new npm dependencies. Create `Dockerfile.worker`. Extend `.env.example` with all new environment variables.

**Technical actions:**

- Add `minio` service to `compose.yaml` — image `minio/minio`, ports 9000 (API) and 9001 (console), env `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, command `server /data --console-address ":9001"`, volume for data persistence, healthcheck
- Add `redis` service to `compose.yaml` — image `redis:7-alpine`, port 6379, healthcheck
- Add `video-worker` service to `compose.yaml` — build from `Dockerfile.worker`, depends on `db` (healthy), `redis` (healthy), `minio` (healthy), env vars for DB/MinIO/Redis connections. No port exposed (internal only). Command: `npm run start:worker`
- Create `nestjs-project/Dockerfile.worker` — base `node:22-alpine`, install `ffmpeg` via `apk`, copy `package.json`, `npm install`, copy source, default command `npm run start:worker`
- Install npm dependencies in nestjs-project: `@nestjs/bullmq@^11.0.4`, `bullmq@^5.x`, `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`, `@aws-sdk/lib-storage@^3.x`
- Update `.env.example` — add `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET_VIDEOS`, `MINIO_BUCKET_THUMBNAILS`, `REDIS_HOST`, `REDIS_PORT`

**Dependencies:** None

**Acceptance criteria:**

- `docker compose up -d` starts minio, redis, and video-worker services — all show `running` in `docker compose ps`
- MinIO API is reachable at `http://localhost:9000` and console at `http://localhost:9001`
- Redis responds to `PING` on port 6379
- video-worker container builds without errors — `docker compose build video-worker` exits with code 0

---

### SI-03.2 — Video Entity, Migration e Configuração de Módulos

**Description:** Create the `Video` entity with all columns, generate the migration, register BullModule and S3Module in the application, and extend the Joi env validation schema.

**Technical actions:**

- Create `src/videos/entities/video.entity.ts` — `@Entity('videos')` with columns: `id` (uuid PK, generated via `uuid-ossp`), `channel_id` (uuid FK → channels.id), `title` (varchar(255)), `status` (enum: `pending`, `processing`, `ready`, `error`, default `pending`), `status_message` (text, nullable), `file_key` (varchar(512), nullable — MinIO object key), `file_size` (bigint, nullable), `thumbnail_key` (varchar(512), nullable), `duration` (integer, nullable — seconds), `mime_type` (varchar(100), nullable), `metadata` (jsonb, nullable — ffprobe output), `upload_id` (varchar(255), nullable — multipart upload ID), `created_at` (CreateDateColumn), `updated_at` (UpdateDateColumn). Define `@ManyToOne(() => Channel)` relation.
- Generate migration via `npm run migration:generate -- src/database/migrations/CreateVideosTable`
- Create `src/config/storage.config.ts` — `registerAs('storage', ...)` reading `MINIO_*` vars
- Create `src/config/queue.config.ts` — `registerAs('queue', ...)` reading `REDIS_HOST`, `REDIS_PORT`
- Update `src/config/env.validation.ts` — add all new env vars to Joi schema
- Create `src/storage/storage.module.ts` — `StorageModule` with `S3Client` provider configured from `storage` config. Export `S3_CLIENT` token and `StorageModule`
- Register `BullModule.forRoot()` in `AppModule` with Redis connection from `queue` config. Register `BullModule.registerQueue({ name: 'video-processing' })` in `VideosModule`
- Create `src/videos/videos.module.ts` — `VideosModule` with `TypeOrmModule.forFeature([Video])`, imports `BullModule.registerQueue({ name: 'video-processing' })`, `StorageModule`, register `VideosService`, `VideosController`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/entities/video.entity.integration-spec.ts` | Integration | Column types, defaults (status=pending), FK constraint to channels, nullable fields |
| `src/storage/storage.module.spec.ts` | Unit | Module compiles, S3Client is provided with correct config |
| `src/videos/videos.module.spec.ts` | Unit | Module compiles with BullQueue and TypeOrm wiring |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- Migration creates `videos` table with all columns — FK to `channels` is enforced
- Inserting a video with `channel_id` referencing a non-existent channel fails with FK violation
- New video defaults to `pending` status
- Application starts with all new env vars — config is read correctly

---

### SI-03.3 — Serviço de Storage (Upload via Presigned URLs)

**Description:** Implement `VideosStorageService` with MinIO operations: initiate multipart upload, generate presigned URLs for parts, complete multipart, abort multipart, and generate presigned GET URLs for streaming/download. Create `VideosService` with video CRUD and status management.

**Technical actions:**

- Create `src/storage/storage.service.ts` — methods:
  - `initMultipartUpload(channelId, title, mimeType)` → calls `CreateMultipartUploadCommand`, returns `{ uploadId, fileKey }`
  - `generatePresignedPartUrls(uploadId, fileKey, partCount)` → generates presigned `UploadPartCommand` URLs for each part (50MB each), returns `{ partNumber, url }[]`
  - `completeMultipartUpload(uploadId, fileKey, parts)` → calls `CompleteMultipartUploadCommand` with `{ PartNumber, ETag }[]`
  - `abortMultipartUpload(uploadId, fileKey)` → calls `AbortMultipartUploadCommand`
  - `generatePresignedGetUrl(fileKey, expiresIn)` → generates presigned `GetObjectCommand` URL
  - `getObjectMetadata(fileKey)` → calls `HeadObjectCommand`, returns `{ contentLength, contentType }`
- Create `src/videos/videos.service.ts` — methods:
  - `create(channelId, title)` → creates video record in `pending` status, returns video entity
  - `findById(id)` → finds video by UUID
  - `updateStatus(id, status, message?)` → updates status and optional status_message
  - `updateAfterProcessing(id, duration, metadata, thumbnailKey)` → sets ready status with processing results
  - `markAsError(id, message)` → sets error status with message
  - `findByChannel(channelId)` → lists videos by channel
- Create `src/storage/buckets.service.ts` — `ensureBuckets()` called on app startup to create `videos` and `thumbnails` buckets if they don't exist

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/storage/storage.service.integration-spec.ts` | Integration | Full multipart lifecycle: init → parts → complete → GET; abort cleans up; presigned GET returns correct content |
| `src/videos/videos.service.spec.ts` | Unit | Create, findById, updateStatus, markAsError — all status transitions |
| `src/storage/buckets.service.integration-spec.ts` | Integration | Ensures buckets are created if missing |

**Dependencies:** SI-03.2

**Acceptance criteria:**

- Multipart upload lifecycle works end-to-end with real MinIO: init, generate part URLs, upload parts, complete
- Aborted multipart upload is cleaned up — subsequent GET returns 404
- Presigned GET URL returns the correct file content within expiration window
- Video CRUD operations persist correctly to database

---

### SI-03.4 — Upload API Endpoints

**Description:** Implement the four upload-related HTTP endpoints: initiate upload, get presigned part URLs, complete upload, and abort upload.

**Technical actions:**

- Implement `POST /videos` (authenticated) in `VideosController`:
  - Request body: `{ title: string, mimeType: string, fileSize: number }`
  - Calls `VideosService.create()` → video in `pending` status
  - Calls `StorageService.initMultipartUpload()` → multipart upload ID
  - Returns `201` with `{ id, uploadId, fileKey, status: 'pending' }`
- Implement `GET /videos/:id/upload-urls` (authenticated, owner-only) in `VideosController`:
  - Query param: `partCount` (number of parts)
  - Validates video belongs to authenticated user's channel
  - Calls `StorageService.generatePresignedPartUrls()`
  - Returns `200` with `{ parts: [{ partNumber, url }], partSize }`
- Implement `POST /videos/:id/complete` (authenticated, owner-only) in `VideosController`:
  - Request body: `{ parts: [{ partNumber, etag }] }`
  - Validates ownership, calls `StorageService.completeMultipartUpload()`
  - Calls `VideosService.updateStatus()` → `processing`
  - Enqueues BullMQ job `{ videoId }` on `video-processing` queue
  - Returns `200` with `{ id, status: 'processing' }`
- Implement `POST /videos/:id/abort` (authenticated, owner-only) in `VideosController`:
  - Validates ownership
  - Calls `StorageService.abortMultipartUpload()`
  - Calls `VideosService.markAsError()` → `error` with message "Upload aborted"
  - Returns `204` with no body

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.controller.spec.ts` | Unit | Controller delegates correctly to service for all four endpoints |
| `test/videos-upload.e2e-spec.ts` | E2E | Full upload flow: POST → GET URLs → complete → video is `processing`; abort returns 204; non-owner gets 403; invalid video ID gets 404 |

**Dependencies:** SI-03.3, SI-03.2

**Acceptance criteria:**

- `POST /videos` with valid title returns 201 with `{ id, uploadId, fileKey, status: 'pending' }` — video created in DB
- `GET /videos/:id/upload-urls?partCount=10` returns 200 with array of 10 presigned URLs — each URL is valid for PUT
- `POST /videos/:id/complete` with valid parts returns 200 with `status: 'processing'` — a BullMQ job is enqueued
- `POST /videos/:id/abort` returns 204 — video status is `error` with message

---

### SI-03.5 — Worker de Vídeo

**Description:** Create the separate worker NestJS application that consumes `video-processing` queue jobs, downloads the video from MinIO, extracts metadata via ffprobe, generates thumbnail via FFmpeg, uploads thumbnail to MinIO, and updates the video record.

**Technical actions:**

- Create `src/video-worker/` directory:
  - `main.ts` — bootstrap NestJS app with bull module, TypeORM, storage module
  - `video.processor.ts` — `@Processor('video-processing')` class extending `WorkerHost`. In `process(job)`:
    1. Fetch video entity from DB
    2. Download video from MinIO to temp file using `GetObjectCommand` (stream to temp file)
    3. Extract metadata via `ffprobe` (duration, codec, resolution, bitrate, format)
    4. Generate thumbnail at 50% timestamp via `ffmpeg -ss` command (1280×720 JPEG)
    5. Upload thumbnail to MinIO `thumbnails/` bucket with key `{videoId}/thumbnail.jpg`
    6. Delete temp files
    7. Update video entity: set metadata, duration, thumbnail_key, status → `ready`
    8. If any step fails: catch error, set status → `error` with message
- Create `npm run start:worker` script in `package.json` — `nest start video-worker`
- Create `src/video-worker/video-worker.module.ts` — imports `BullModule.registerQueue({ name: 'video-processing' })`, TypeORM, StorageModule. Register `VideoProcessor`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/video-worker/video.processor.integration-spec.ts` | Integration | Worker processes a real video file: downloads from MinIO, extracts metadata, generates thumbnail, uploads thumbnail, updates DB |
| `src/video-worker/video.processor.spec.ts` | Unit | Worker handles ffprobe/ffmpeg failures gracefully — sets error status with message |

**Dependencies:** SI-03.4, SI-03.3, SI-03.2

**Acceptance criteria:**

- Worker picks up a job from `video-processing` queue — processes the video
- After processing: video has `duration`, `metadata` (ffprobe output), `thumbnail_key`, and status `ready`
- If the video file is corrupted/missing: video status becomes `error` with descriptive message
- Worker cleans up temp files after processing (success or failure)

---

### SI-03.6 — Streaming e Download

**Description:** Implement streaming (partial content via presigned GET redirect) and download endpoints for ready videos.

**Technical actions:**

- Implement `GET /videos/:id/stream` in `VideosController`:
  - Finds video by UUID — returns 404 if not found
  - Returns 409 CONFLICT if status is not `ready`
  - Calls `StorageService.generatePresignedGetUrl(fileKey, expiresIn=3600)`
  - Returns 302 redirect (Found) to the presigned URL. Browser `<video>` tag follows the redirect and sends Range headers to MinIO — MinIO responds with 206 Partial Content natively
- Implement `GET /videos/:id/download` in `VideosController`:
  - Same preconditions as stream
  - Generates presigned GET URL with `ResponseContentDisposition: attachment; filename="video.mp4"`
  - Returns 302 redirect to the presigned URL with download disposition
- Add `GET /videos/:id` metadata endpoint:
  - Returns video metadata (title, duration, thumbnail URL, status, channel) — public for ready videos, owner-only for non-ready
  - Returns 200 with `{ id, title, status, duration, thumbnailUrl, channel, createdAt }`
  - Thumbnail URL is a presigned GET URL for the thumbnail key

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.controller.spec.ts` | Unit | Stream/download return 302 redirect; non-ready returns 409; not found returns 404 |
| `test/videos-stream.e2e-spec.ts` | E2E | Stream endpoint returns 302 with Location header pointing to MinIO; download returns 302 with content-disposition; thumbnail URL is accessible |

**Dependencies:** SI-03.5, SI-03.3, SI-03.2

**Acceptance criteria:**

- `GET /videos/:id/stream` for a ready video returns 302 with a presigned MinIO URL in the Location header
- `GET /videos/:id/download` for a ready video returns 302 with download filename in the URL
- `GET /videos/:id/stream` for a non-ready video returns 409 CONFLICT
- `GET /videos/:id` returns video metadata — thumbnail URL is a valid presigned GET URL
- `GET /videos/:id` for non-existent video returns 404

---

## Technical Specifications

### Data Model

#### Video

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, default `gen_random_uuid()` | Primary identifier (UUID v4) |
| channel_id | uuid | FK → channels.id, NOT NULL | Owner of the video |
| title | varchar(255) | NOT NULL | User-provided title |
| status | varchar(20) | NOT NULL, default `'pending'` | Enum: pending, processing, ready, error |
| status_message | text | NULLABLE | Error description or status detail |
| file_key | varchar(512) | NULLABLE | MinIO object key: `videos/{id}/master.mp4` |
| file_size | bigint | NULLABLE | File size in bytes |
| thumbnail_key | varchar(512) | NULLABLE | MinIO object key: `thumbnails/{id}/thumbnail.jpg` |
| duration | integer | NULLABLE | Duration in seconds |
| mime_type | varchar(100) | NULLABLE | MIME type of the video file |
| metadata | jsonb | NULLABLE | Full ffprobe output as JSON |
| upload_id | varchar(255) | NULLABLE | S3 multipart upload ID |
| created_at | timestamptz | NOT NULL, default now() | Auto-set |
| updated_at | timestamptz | NOT NULL, default now() | Auto-updated |

**Relations:** Video → Channel (many-to-one) via `channel_id`
**Indexes:** `(channel_id)` for channel video listing; `(status)` for worker queries; `(created_at DESC)` for ordering

---

### API Contracts

#### POST /videos (SI-03.4)

**Request headers:**
- Authorization: Bearer `<access_token>`

**Request body:**
- `title`: string, required — max 255 chars
- `mimeType`: string, required — must be `video/*`
- `fileSize`: number, required — in bytes, max 10737418240 (10GB)

**Response 201:**
```json
{
  "id": "uuid",
  "uploadId": "multipart-upload-id",
  "fileKey": "videos/{uuid}/master.mp4",
  "status": "pending"
}
```

**Error responses:**
- 401 UNAUTHORIZED: missing or invalid token
- 400 validation error: invalid title/mimeType/fileSize
- 409 FILE_SIZE_EXCEEDED: fileSize > 10GB

---

#### GET /videos/:id/upload-urls (SI-03.4)

**Request headers:**
- Authorization: Bearer `<access_token>`

**Query params:**
- `partCount`: number, required — number of parts (1 to 10000)

**Response 200:**
```json
{
  "parts": [
    { "partNumber": 1, "url": "https://minio:9000/videos/..." },
    { "partNumber": 2, "url": "https://minio:9000/videos/..." }
  ],
  "partSize": 52428800
}
```

**Error responses:**
- 403 FORBIDDEN: video does not belong to user's channel
- 404 NOT_FOUND: video not found
- 409 INVALID_VIDEO_STATUS: video is not in pending status

---

#### POST /videos/:id/complete (SI-03.4)

**Request headers:**
- Authorization: Bearer `<access_token>`

**Request body:**
- `parts`: array of `{ partNumber: number, etag: string }`, required

**Response 200:**
```json
{
  "id": "uuid",
  "status": "processing"
}
```

**Error responses:**
- 403 FORBIDDEN: video does not belong to user's channel
- 404 NOT_FOUND: video not found
- 409 INVALID_VIDEO_STATUS: video is not in pending status

---

#### POST /videos/:id/abort (SI-03.4)

**Request headers:**
- Authorization: Bearer `<access_token>`

**Response 204:** No body

**Error responses:**
- 403 FORBIDDEN: video does not belong to user's channel
- 404 NOT_FOUND: video not found

---

#### GET /videos/:id (SI-03.6)

**Response 200:**
```json
{
  "id": "uuid",
  "title": "My Video",
  "status": "ready",
  "duration": 596,
  "thumbnailUrl": "https://minio:9000/thumbnails/...",
  "channel": {
    "id": "uuid",
    "name": "My Channel",
    "nickname": "my-channel"
  },
  "createdAt": "2026-06-28T12:00:00Z"
}
```

**Error responses:**
- 404 NOT_FOUND: video not found

---

#### GET /videos/:id/stream (SI-03.6)

**Response 302:**
- Location: `<presigned MinIO URL with Range support>`

**Error responses:**
- 404 NOT_FOUND: video not found
- 409 VIDEO_NOT_READY: video status is not ready

---

#### GET /videos/:id/download (SI-03.6)

**Response 302:**
- Location: `<presigned MinIO URL with content-disposition: attachment>`

**Error responses:**
- 404 NOT_FOUND: video not found
- 409 VIDEO_NOT_READY: video status is not ready

---

### Authorization Matrix

| Endpoint | Public | Authenticated | Owner |
|----------|--------|---------------|-------|
| POST /videos | | ✓ | |
| GET /videos/:id/upload-urls | | | ✓ |
| POST /videos/:id/complete | | | ✓ |
| POST /videos/:id/abort | | | ✓ |
| GET /videos/:id | ✓* | | |
| GET /videos/:id/stream | ✓* | | |
| GET /videos/:id/download | ✓* | | |

*Public only for `ready` videos. Non-ready videos return 404 to non-owners (to avoid information leakage).

---

### Error Catalog

Error response format (inherited from Phase 02):
```json
{ "statusCode": number, "error": string, "message": string }
```

| Code | HTTP | Message | Trigger |
|------|------|---------|---------|
| FILE_SIZE_EXCEEDED | 409 | File size exceeds the maximum allowed size of 10GB | POST /videos with fileSize > 10737418240 |
| INVALID_VIDEO_STATUS | 409 | Video status does not allow this operation | POST /videos/:id/complete on non-pending video |
| VIDEO_NOT_READY | 409 | Video is not ready for streaming | GET /videos/:id/stream on non-ready video |
| VIDEO_NOT_FOUND | 404 | Video not found | GET /videos/:id with non-existent UUID |

---

### Events/Messages

| Event/Job | Payload | Publisher | Consumer | Delivery |
|-----------|---------|-----------|----------|----------|
| `video-processing` | `{ videoId: string }` | VideosController (POST /videos/:id/complete) | VideoProcessor (video-worker) | ack-required, retry 3x with exponential backoff |

---

## Dependency Map

```
SI-03.1 (no deps)  ← Infrastructure: Compose + Dockerfile + npm install
├── SI-03.2        ← Entity + Migration + Module config (depends on SI-03.1 for deps)
│   ├── SI-03.3    ← Storage Service + Videos Service (depends on entity + modules)
│   │   ├── SI-03.4  ← Upload API Endpoints (depends on services)
│   │   │   └── SI-03.5  ← Video Worker (depends on upload API + services)
│   │   └── SI-03.6  ← Streaming + Download (depends on services)
```

## Deliverables

- [ ] All 6 SIs implemented and their tests pass
- [ ] Full test suite passes: `npm test` (unit + integration)
- [ ] E2E tests pass: `npm run test:e2e`
- [ ] Type-check passes: `npx tsc --noEmit` (code 0)
- [ ] Lint passes: `npm run lint`
- [ ] Project builds: `npm run build`
- [ ] `Dockerfile.worker` builds without errors
- [ ] `compose.yaml` starts all 6 services (db, mailpit, minio, redis, nestjs-api, video-worker)
- [ ] CLAUDE.md updated with video module, endpoints, and infrastructure
- [ ] `docs/phases/phase-03-videos/progress.md` created and reflects completed SIs
