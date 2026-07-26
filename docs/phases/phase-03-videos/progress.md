# Phase 03 — Upload e Processamento de Vídeos — Progress

**Status:** completed
**SIs:** 6/6 completed

### SI-03.1 — Nova Infraestrutura no Docker Compose
- **Status:** completed
- **Tests:** no tests required (infrastructure)
- **Observations:** compose.yaml with minio, redis, video-worker; Dockerfile.worker created

### SI-03.2 — Video Entity, Migration e Configuração de Módulos
- **Status:** completed
- **Tests:** storage.module.spec.ts, videos.module.spec.ts, video-worker.module.spec.ts — all pass
- **Observations:** Video entity with 14 fields + FK to channels; migration created; StorageModule with S3Client provider; env.validation.ts extended

### SI-03.3 — Serviço de Storage (Upload via Presigned URLs)
- **Status:** completed
- **Tests:** storage.service.spec.ts (5 tests), videos.service.spec.ts (9 tests), storage.service.integration-spec.ts, buckets.service.integration-spec.ts — all pass
- **Observations:** StorageService: initMultipartUpload, generatePresignedPartUrls, completeMultipartUpload, abortMultipartUpload, generatePresignedGetUrl, getObjectMetadata, uploadFile, downloadToFile

### SI-03.4 — Upload API Endpoints
- **Status:** completed
- **Tests:** videos.e2e-spec.ts: POST /videos, upload-urls, complete, metadata, stream, thumbnail
- **Observations:** 9 endpoints; DTOs with class-validator (CreateVideoDto with @Max 10GB, CompleteUploadDto); domain exceptions (VideoNotFoundException, InvalidVideoStatusException, FileSizeExceededException, ChannelNotFoundException)

### SI-03.5 — Worker de Vídeo
- **Status:** completed
- **Tests:** video.processor.spec.ts (3 tests) — all pass
- **Observations:** VideoWorkerModule bootstrap standalone; VideoProcessor extends WorkerHost consuming `video-processing` queue; FFprobe metadata extraction; FFmpeg thumbnail (1280x720)

### SI-03.6 — Streaming e Download
- **Status:** completed
- **Tests:** videos.e2e-spec.ts: stream (409 on non-ready), download (pending), thumbnail (null case)
- **Observations:** Stream/download endpoints return HTTP 302 redirect via @Redirect() decorator; presigned GET URLs from MinIO

## Code Quality
- **tsc --noEmit:** PASS (exit 0)
- **npm run lint:** PASS (exit 0)
- **npm test (unit + integração):** 250/250 PASS (33 suites). `testRegex` cobre `*.spec.ts` **e** `*.integration-spec.ts`, então `npm test` não é uma suíte só de unit — exige a stack do Compose no ar (Postgres, Redis, MinIO, Mailpit). Rodar com `--runInBand`.
- **npm run test:e2e:** 60/60 PASS (4 suites: `app`, `auth`, `swagger`, `videos`)
- **Testes da Fase 03 especificamente** (`src/videos`, `src/storage`, `src/video-worker`): 79/79 PASS em 10 suites
- **Idempotência:** a suíte completa foi executada duas vezes seguidas contra o mesmo banco, verde nas duas
- **Domain exceptions:** VideosService and ChannelsService use domain exceptions (not HTTP exceptions)
- **DTOs:** CreateVideoDto and CompleteUploadDto with class-validator decorators

## Infraestrutura verificada

`docker compose up -d` sobe os 6 serviços a partir de um clone limpo:

| Serviço | Verificação |
|---------|-------------|
| `db` (postgres:17) | `pg_isready -U streamtube` → accepting connections |
| `redis` (redis:7-alpine) | `redis-cli ping` → PONG |
| `minio` | `/minio/health/live` → 200 |
| `mailpit` | healthy |
| `nestjs-api` | bootstrap OK; `GET /` → 200 |
| `video-worker` | log `Video worker started, waiting for jobs...`; ffmpeg 8.1.2 + ffprobe 8.1.2 na imagem |

O `video-worker` **não** monta o diretório do host: o `dist/` vem do `npm run build`
executado dentro da imagem (`Dockerfile.worker`). Confirmado removendo o `dist/` do
host e recriando o container — sobe igual.

## Limitações conhecidas

Registradas aqui por rastreabilidade; nenhuma bloqueia os entregáveis da fase.

- **O teto de 10GB é declarativo.** `@Max` em `CreateVideoDto.fileSize` valida o valor
  que o cliente *declara*, não o tamanho real no storage. `StorageService.getObjectMetadata`
  existe mas não é usado no `POST /videos/:id/complete` para conferir o `contentLength`,
  e `partCount` não tem teto. O requisito da fase — não passar os bytes pela API — é
  atendido integralmente; a checagem do tamanho real fica para Fase 04.
- **`status` é `varchar(20)` sem CHECK constraint.** O enum `VideoStatus` só é garantido
  pela aplicação; o banco aceita qualquer string ≤20 chars.
- **A relação Channel↔Video é unidirecional.** Falta o `@OneToMany` em `Channel`, contra
  a rule `nestjs-entities.md`.
- **Cobertura de teste com lacunas:** não há `videos.controller.spec.ts`; o caminho feliz
  de `/stream` e `/download` (vídeo já `ready`) e o `POST /videos/:id/abort` não são
  exercitados — o e2e nunca chega a `ready` porque o worker não roda durante os testes.
- **`GET /videos/:id/thumbnail` responde com chaves diferentes** conforme o caso:
  `{ url }` quando há thumbnail e `{ thumbnailUrl: null }` quando não há.
- **`Content-Disposition` do download usa `video.title` cru** e extensão `.mp4` fixa.
