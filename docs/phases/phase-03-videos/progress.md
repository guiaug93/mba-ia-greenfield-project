# Phase 03 — Upload e Processamento de Vídeos — Progress

**Status:** in_progress
**SIs:** 5/6 completed

### SI-03.1 — Nova Infraestrutura no Docker Compose
- **Status:** completed
- **Tests:** no tests
- **Observations:** compose.yaml extends with minio, redis, video-worker; Dockerfile.worker created; npm deps installed

### SI-03.2 — Video Entity, Migration e Configuração de Módulos
- **Status:** completed
- **Tests:** storage.module.spec.ts, videos.module.spec.ts — both pass
- **Observations:** Video entity with 12 fields + FK to channels; migration created; StorageModule with S3Client provider; env.validation.ts extended

### SI-03.3 — Serviço de Storage (Upload via Presigned URLs)
- **Status:** completed
- **Tests:** storage.service.spec.ts (5 tests), videos.service.spec.ts (8 tests) — all pass
- **Observations:** StorageService: initMultipartUpload, generatePresignedPartUrls, completeMultipartUpload, abortMultipartUpload, generatePresignedGetUrl, getObjectMetadata, uploadFile, downloadToFile; VideosService: CRUD + status transitions + ownership; BucketsService; S3_CLIENT extracted to storage.constants.ts to break circular dep

### SI-03.4 — Upload API Endpoints
- **Status:** completed
- **Tests:** pending (no separate controller spec yet; validated via module test)
- **Observations:** VideosController: 9 endpoints (create, init-upload, upload-urls, complete, abort, getMetadata, stream, download, thumbnail); assertStatus é síncrono

### SI-03.5 — Worker de Vídeo
- **Status:** completed
- **Tests:** pending (unit/integration tests not implemented yet)
- **Observations:** VideoWorkerModule bootstrap standalone NestJS app; VideoProcessor extends WorkerHost consuming `video-processing` queue; FFprobe metadata extraction; FFmpeg thumbnail (1280×720); download/upload via StorageService; temp file cleanup; error handling

### SI-03.6 — Streaming e Download
- **Status:** pending
- **Tests:** pending
- **Observations:** Endpoints implemented in VideosController (stream, download, thumbnail — presigned GET redirect); falta testar fluxo completo

## Key Notes
- S3_CLIENT constant extracted to storage.constants.ts to avoid circular import between storage.module.ts and storage.service.ts
- assertStatus é síncrono (não é async) — ajustes feitos no controller (removeu await) e nos testes
- start:worker script atualizado para `node dist/video-worker/main.js`
- Dockerfile.worker atualizado com build completo (npm ci, npm run build, CMD node)
