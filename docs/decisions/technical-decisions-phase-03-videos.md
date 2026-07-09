# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

> **Phase:** 03 — Upload e Processamento de Vídeos
> **Status:** Finalized
> **Date:** 2026-06-28

---

## TD-01: Queue Technology

**Context:** Phase 03 requires asynchronous video processing (metadata extraction, thumbnail generation) after upload. The project plan explicitly leaves this decision open ("TBD"). The queue must integrate with NestJS, support retry with backoff, job persistence, and concurrency control.

**Options:**

### Option A: BullMQ (Redis-backed)
- Node.js queue library built on Redis. Uses sorted sets and streams for job management. Provides priorities, delayed jobs, repeatable jobs, concurrency control, rate limiting, and a monitoring dashboard (Bull Board). Integrates via `@nestjs/bullmq` (official NestJS package). TypeScript-first since v5.
- **Pros:** Direct NestJS integration via `@nestjs/bullmq` with `@Processor`/`@Process` decorators. TypeScript-native. Built-in retry with exponential backoff. Job progress tracking. Bull Board dashboard for monitoring. No new infrastructure if Redis already exists. Active community and maintenance.
- **Cons:** Redis is an additional service in the Compose stack (not currently present). Redis persistence (AOF/RDB) is not as strong as AMQP's disk durability. No native fan-out or topic exchange routing — only queue-based dispatch. Workers must be Node.js (not polyglot).

### Option B: RabbitMQ (AMQP broker)
- Standalone message broker implementing AMQP. Supports exchanges (direct, topic, fanout, headers), binding keys, dead-letter exchanges, and per-queue TTL. Integrates via `@nestjs/microservices` or `@golevelup/nestjs-rabbitmq`. Language-agnostic wire protocol.
- **Pros:** Stronger durability guarantees (disk persistence by default). Native complex routing via exchanges/bindings. Language-agnostic — workers could be written in Python/Go if needed. Dead-letter exchange at the protocol level. Mature and battle-tested in enterprise.
- **Cons:** Additional operational complexity (clustering, federation, queue management). No built-in job scheduling or rate limiting (requires plugins or manual implementation). Heavier infrastructure than Redis. Less natural NestJS integration than BullMQ. Overkill for a single Node.js-only worker.

**Recommendation:** **Option A (BullMQ)** — The project's workers are exclusively Node.js (NestJS). BullMQ provides the richest job-processing feature set for this stack: TypeScript types, built-in retry with backoff, rate limiting, concurrency control, and a monitoring dashboard. Redis is lightweight and easy to operate. The lack of fan-out/exchange routing is irrelevant since there is exactly one consumer (the video worker).

---

## TD-02: Upload Strategy (10GB without blocking)

**Context:** Users must upload video files up to 10GB. Passing the entire file through the NestJS API would block the HTTP thread, consume excessive memory, and tie up API resources. The upload must happen without holding the API server during the transfer.

**Options:**

### Option A: Direct-to-Storage via Presigned URL (Single PUT)
- The API generates a presigned PUT URL from MinIO/S3 and returns it to the client. The client uploads directly to MinIO by PUTting the file to that URL. The API never touches the file bytes. MinIO/S3 limits: single PUT max 5GB.
- **Pros:** Simplest implementation — single presigned PUT URL, no multipart complexity. Zero load on the API server during upload. Direct upload to storage at bandwidth speed.
- **Cons:** **Hard cap at 5GB** — MinIO/S3 rejects PUT >5GB. Requires client-side handling of the upload (browser fetch/axios). No resume on failure — if the connection drops mid-upload, the entire file must be re-uploaded. Not suitable for the 10GB requirement alone.

### Option B: Multipart Upload via Presigned URLs
- The API initiates an S3 multipart upload, generates presigned URLs for each part (part size e.g., 50MB), and returns the list to the client. The client uploads each part in parallel, then calls the API to complete the multipart upload. Supports up to 5TiB total (10,000 parts × 5GiB max per part).
- **Pros:** No 5GB limit — supports files up to 5TiB. Parts can be retried individually — a dropped connection only loses the current part (~50MB), not the entire file. No load on the API server during upload. Parallel part upload improves speed.
- **Cons:** More complex than single PUT — multipart lifecycle (create → upload parts → complete). Client must manage concurrent part uploads. Requires API endpoints for multipart orchestration (init, complete, abort). More round trips to the API.

### Option C: API Pass-Through with Busboy (Proxied)
- The client uploads directly to the NestJS API endpoint. The API uses Busboy (or multer) to stream the file through to MinIO without buffering to disk. The file arrives at the API and is forwarded to storage in chunks.
- **Pros:** Simple client — just POST the file to one endpoint. Full control over upload validation (virus scan, format check) before it reaches storage. No presigned URL management.
- **Cons:** **The API is the bottleneck** — even with streaming, the API holds the HTTP connection for the entire upload duration (potentially minutes for 10GB). Horizontal scaling of the API becomes harder. Memory can spike if streaming pauses. Violates the "don't block the API during upload" requirement for large files.

**Recommendation:** **Option B (Multipart Upload via Presigned URLs)** with a fallback to single PUT for files ≤5GB. This is the only option that satisfies the 10GB requirement without blocking the API. The multipart lifecycle is well-documented in the S3 API and MinIO supports it natively. Client complexity is manageable with standard libraries.

---

## TD-03: Worker Architecture (Processing & Thumbnail Generation)

**Context:** After upload, the video needs automatic processing: metadata extraction (duration, codec, resolution, bitrate) and thumbnail generation (a JPEG frame from the video). This processing is CPU-intensive and must not block the API. The worker consumes jobs from the queue defined in TD-01.

**Options:**

### Option A: Separate Container with FFmpeg CLI (Node.js, no wrapper)
- A dedicated NestJS worker container (separate process in Docker Compose) runs a BullMQ consumer. On receiving a job, it downloads the video from MinIO to local temp storage, calls `ffprobe` via `child_process.execFile()` to extract metadata as JSON, calls `ffmpeg -ss <timestamp> -i <input> -vframes 1 <output>` to generate a thumbnail, uploads the thumbnail back to MinIO, and updates the video record in the database. No npm wrapper library is used — the FFmpeg CLI is invoked directly.
- **Pros:** Clear separation of concerns — API and worker scale independently. FFmpeg is the industry standard — supports all video formats. Zero npm dependencies for media processing — direct CLI calls via built-in `child_process`. Minimal Docker image based on `node:22-alpine` with FFmpeg installed via `apk add ffmpeg`.
- **Cons:** Requires downloading the video to the worker's local filesystem before processing (~10GB disk needed temporarily). Worker must have the same DB access as the API (same TypeORM entities). File download time adds to processing latency.

### Option B: Embedded FFmpeg in API Process
- The API process itself runs FFmpeg as a child process within the same container. After the upload completes (via presigned URL callback), the API downloads the video, processes it, and updates the DB inline.
- **Pros:** Simpler infrastructure — no separate worker container. No cross-service communication (no queue needed for processing). Lower latency — processing starts immediately.
- **Cons:** **Blocks the API** — FFmpeg is CPU-intensive and would degrade API response times. Mixes API concerns with processing concerns. No isolation — an FFmpeg crash could bring down the API. Cannot scale processing independently. Violates separation of concerns.

### Option C: Python Worker with PyAV or ffmpeg-python
- A separate Python container uses PyAV (FFmpeg bindings) or `ffmpeg-python` for processing. Consumes from the same BullMQ queue via a Redis client. Updates the DB via a direct PostgreSQL connection.
- **Pros:** Python has richer media processing libraries (OpenCV, PyAV). Potentially more expressive for complex processing pipelines.
- **Cons:** **Polyglot complexity** — the project is entirely TypeScript/NestJS. A Python worker means maintaining two codebases, two dependency systems, and two deployment pipelines. No native BullMQ client in Python — must use raw Redis streams. DB access must be manually implemented (no TypeORM). Not worth the complexity for simple metadata extraction + thumbnail generation.

**Recommendation:** **Option A (Separate Container with FFmpeg CLI)** — The worker is a NestJS application consuming from the same BullMQ queue, sharing the same TypeORM entities (imported as a library). The FFmpeg binary is installed in the Docker image via `apk add ffmpeg`. This keeps the stack homogeneous (TypeScript only), isolates CPU load from the API, and allows independent scaling. No FFmpeg npm wrapper is needed — direct CLI invocation is the simplest approach for two operations (metadata + thumbnail).

---

## TD-04: Unique URL and Streaming Strategy

**Context:** Each video must have a unique, conflict-free URL for playback and download. The URL must support streaming (partial content / 206 Partial Content) so the browser can start playback without downloading the entire file.

**Options:**

### Option A: UUID v7 as identifier + Streaming via NestJS Proxy
- Each video gets a UUID v7 (time-ordered, unique, conflict-free) as its primary identifier. URLs use `/videos/:uuid/stream`. The NestJS API proxies the stream: receives the request, reads the `Range` header, calls MinIO's `getObject` with the Range parameter, and pipes the response as 206 Partial Content. Download uses the same mechanism without the Range header.
- **Pros:** UUID v7 is natively unique — no collision checking needed. API controls access/authorization before streaming. Simple client — just requests `/videos/:uuid/stream`. Works with any HTML5 `<video>` tag (browser sends Range headers automatically).
- **Cons:** **All traffic passes through the API** — every byte streamed goes through NestJS, adding latency and load. The API becomes a bottleneck for video traffic. 10GB video streamed 10 times = 100GB through the API. Bandwidth costs and horizontal scaling pressure.

### Option B: UUID v7 as identifier + Direct MinIO Streaming via Presigned URL
- Videos are stored in MinIO with a structured key (e.g., `videos/{uuid}/master.mp4`). The API endpoint `/videos/:uuid/stream` generates a presigned GET URL from MinIO and returns a **302 Redirect** to that URL. The client follows the redirect and streams directly from MinIO. MinIO natively supports Range requests — the browser sends Range, MinIO responds with 206.
- **Pros:** **Zero load on the API for streaming** — all video bytes go directly from MinIO to the client. MinIO is optimized for this workload (HTTP range-gets are native). Redirect is lightweight (API only generates a URL and sends a 302). Scales horizontally by scaling MinIO (or using S3 in production). Presigned URLs can have short TTLs for security.
- **Cons:** Presigned URL generation is an extra API call. Harder to enforce per-user bandwidth limits or video access policies (presigned URL is public once issued). Slightly more complex client — must handle redirects (browser `<video>` tag handles this automatically). Cannot hide the video's storage location from the client.

### Option C: Combination (UUID + Slug SEO URL + Presigned Streaming)
- Primary route: `/watch/:slug` where slug is a URL-friendly version of the title (e.g., `my-awesome-video`). The slug is unique-indexed in the database (UUID v7 appended if collision occurs). Streaming uses Option B's presigned-redirect approach for efficiency. A separate route `/api/videos/:uuid/stream` for direct UUID-based access.
- **Pros:** SEO-friendly URLs. Human-readable — user sees the title in the URL. Two access paths: slug for public sharing, UUID for canonical internal use. Streaming is efficient (direct to MinIO).
- **Cons:** Slug management adds complexity — uniqueness checking and deduplication logic. Slug changes when the title changes (or stays frozen — needs a policy decision). More routes to maintain.

**Recommendation:** **Option B (UUID v7 + Presigned GET Redirect)** — Efficiency is paramount for video streaming. Passing traffic through the API would defeat the purpose of direct-to-storage upload. UUID v7 is the primary key; a pre-signed GET URL redirects the client to MinIO for the actual bytes. SEO-friendly slugs can be added in Phase 04 (Gerenciamento de Vídeos) if needed.

---

## TD-05: Video Status Lifecycle

**Context:** A video goes through multiple states from creation to playback. The status must be tracked in the database so the system knows whether the video is available, processing, or has failed. The lifecycle affects UI display, API behavior, and worker dispatch.

**Options:**

### Option A: Simple Three-State Lifecycle (draft → processing → ready | error)
- `draft`: Video metadata created, upload initiated but not completed. No file in storage yet.
- `processing`: Upload complete (all parts received), worker job enqueued. Worker is extracting metadata and generating thumbnail.
- `ready`: Processing succeeded. Video is available for streaming and download.
- `error`: Processing failed. Worker set an error message explaining the failure.
- Transitions: draft → processing (on upload complete callback), processing → ready (worker success), processing → error (worker failure).
- **Pros:** Simple, easy to reason about. Clear states visible to the user. Error state with message for debugging. Easy to implement as a TypeORM enum column.
- **Cons:** No distinction between upload-in-progress and upload-complete-awaiting-processing. User cannot see "uploading" progress from the API.

### Option B: Extended Lifecycle with Upload Progress
- Adds `uploading` state between `draft` and `processing`. The video enters `uploading` when the first multipart part is received and stays there until all parts are uploaded and the multipart complete call is made.
- **Pros:** More granular feedback — the API can report "uploading" versus "processing". Clients can distinguish these states in the UI.
- **Cons:** Requires tracking multipart upload progress (number of parts received vs. expected). More complex state machine. The worker still depends on upload completion, not on individual parts.

### Option C: Lifecycle with Reprocessing Support
- Adds a `processing` transition back from `ready` — if the admin manually triggers reprocessing (e.g., thumbnail regeneration), the video goes back to `processing` and then back to `ready`.
- **Pros:** Supports re-processing use cases. Future-proof for admin operations.
- **Cons:** Out of scope for Phase 03 — reprocessing requires admin UI (Phase 04). Adds complexity without immediate value. Can be added later by extending the status enum (backward-compatible).

**Recommendation:** **Option A (Three-State) with one modification: rename `draft` to `pending`** to better reflect that the video was created but upload is not yet complete. The status column uses a TypeORM `enum` type: `pending → processing → ready | error`. The error state includes a `status_message` column for the failure description. Simpler options can be extended later.

---

## Decisions Summary

| ID | Decision | Recommendation | Choice |
|----|----------|---------------|--------|
| TD-01 | Queue Technology | BullMQ | A (BullMQ) |
| TD-02 | Upload Strategy | Multipart via Presigned URLs | B (Multipart Presigned URLs) |
| TD-03 | Worker Architecture | Separate Container + fluent-ffmpeg | A (Separate Container) |
| TD-04 | Unique URL & Streaming | UUID v7 + Presigned GET Redirect | B (UUID + Presigned Redirect) |
| TD-05 | Video Status Lifecycle | Three-state (pending → processing → ready/error) | A (Three-State) |
