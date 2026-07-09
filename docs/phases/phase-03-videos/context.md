# Phase 03 — Upload e Processamento de Vídeos — Context

> **Generated:** 2026-06-28
> **From:** research output + existing artifacts

---

## 1. Phase Goal

Implement video upload (up to 10GB), asynchronous processing (metadata extraction + thumbnail), streaming, and download — all backed by object storage (MinIO), a job queue (BullMQ + Redis), and a dedicated worker container (FFmpeg).

## 2. Current State (Pre-Phase)

What already exists and is functional:

| Area | Status |
|------|--------|
| NestJS 11 API with Express | Running in Docker, port 3000 |
| PostgreSQL 17 | Running in Docker, port 5432 |
| Mailpit (dev email) | Included in Compose |
| Auth module (register, login, refresh, confirm, password reset) | Complete |
| Users module | Complete |
| Channels module (1:1 with user, created on registration) | Complete |
| Common module (DomainException, error filter) | Complete |
| Config module (env validation via Joi) | Complete |
| Database module (TypeORM, migrations, seeds) | Complete |
| Swagger/OpenAPI module | Complete |
| Global JWT guard, ValidationPipe, exception filter | Active |
| Rate limiting (@nestjs/throttler) | Active on auth endpoints |
| Frontend (Next.js) | Exists but out of scope |

## 3. What Phase 03 Adds

| Capability | Description |
|------------|-------------|
| Video entity | Table linked to Channel, with status lifecycle |
| Object storage | MinIO (S3-compatible) in Docker |
| Upload API | Initiate multipart upload, presigned URLs per part, complete/abort |
| Job queue | BullMQ + Redis for async processing |
| Video worker | Separate container consuming queue, processing with FFmpeg CLI via child_process |
| Metadata extraction | Duration, codec, resolution, bitrate via ffprobe |
| Thumbnail generation | JPEG frame at 50% timestamp via FFmpeg |
| Streaming | Presigned GET URL → 302 redirect → direct MinIO range requests |
| Download | Same as streaming but triggers download header |
| Status lifecycle | pending → processing → ready | error |

## 4. Technical Decisions (from research)

| ID | Decision | Choice |
|----|----------|--------|
| TD-01 | Queue Technology | BullMQ |
| TD-02 | Upload Strategy | Multipart via Presigned URLs |
| TD-03 | Worker Architecture | Separate Container + fluent-ffmpeg |
| TD-04 | Unique URL & Streaming | UUID v7 + Presigned GET Redirect |
| TD-05 | Video Status Lifecycle | Three-state (pending → processing → ready/error) |

Full reasoning: `docs/decisions/technical-decisions-phase-03-videos.md`

## 5. New Infrastructure Required

All new services MUST be added to `nestjs-project/compose.yaml`:

| Service | Image / Build | Purpose | Dependencies |
|---------|--------------|---------|--------------|
| `minio` | `minio/minio` | Object storage (videos + thumbnails) | None |
| `redis` | `redis:7-alpine` | BullMQ backend | None |
| `video-worker` | Custom `Dockerfile.worker` | Job processing (FFmpeg) | db, redis, minio |

Bucket structure in MinIO:
- `videos/` — video files organized as `{uuid}/master.mp4`
- `thumbnails/` — thumbnail images organized as `{uuid}/thumbnail.jpg`

## 6. Dependencies With Previous Phases

| Dependency | Phase | Status |
|------------|-------|--------|
| Video belongs to Channel (1:1 with User) | Phase 02 | Complete |
| JWT auth for video upload/download | Phase 02 | Complete |
| DomainException and error filter pattern | Phase 02 | Complete |
| TypeORM + migrations infrastructure | Phase 01 | Complete |
| Docker Compose service naming convention | Phase 01 | Complete |

## 7. Constraints

- All communication between containers uses Docker Compose service names (never `localhost`)
- No file may pass entirely through the API for upload (10GB cap) — use presigned URLs
- Worker must NOT block the API — queue-based async processing
- Streaming must NOT route bytes through the API — direct to MinIO via redirect
- Tests at three levels: unit (`.spec.ts`), integration (`.integration-spec.ts`), e2e (`.e2e-spec.ts`)
- Full DoD: tests green + `npx tsc --noEmit` (0) + `npm run lint` pass

## 8. Out of Scope (for this phase)

- Video editing (title, description, visibility) — Phase 04
- Video categories — Phase 04
- Channel video management panel — Phase 04
- Video player page — Phase 05
- Likes, comments, subscriptions — Phase 06
- Search — Phase 07
- SEO-friendly slug URLs — Phase 04 (simplified)
- Admin reprocessing of videos — deferred
