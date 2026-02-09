# TGN Nuxt + Convex Rebuild

Nuxt frontend/editor and Convex backend replacing the legacy Java + Vue labeling/dashboard stack.

## Stack

- Nuxt 4
- Convex (queries, mutations, actions, http actions)
- Convex Files for PDF/page image storage
- `better-convex-nuxt` for data/auth/upload integration

## Local Setup

1. Install deps:

```bash
bun install
```

2. Configure `.env.local`:

```bash
CONVEX_URL=...
CONVEX_DEPLOY_KEY=...
SITE_URL=http://localhost:3000
CONVEX_SITE_URL=https://<deployment>.convex.site

# Optional external integrations (keep crawlers/lambdas as-is)
TGN_PDF_TO_IMAGE_ENDPOINT=
TGN_OCR_ENDPOINT=
TGN_SEGMENTOR_ENDPOINT=
TGN_CLASSIFIER_ENDPOINT=
TGN_ENRICHMENT_ENDPOINT=
TGN_CRAWLER_WEBHOOK_TOKEN=
```

3. Generate Convex API types:

```bash
bunx convex codegen
```

4. Run app:

```bash
bun run dev
```

## Run Flow

1. Upload a publication at `/upload`.
2. File is stored in Convex Files (`_storage`) and a `publications` record is created.
3. Pipeline (`enqueuePublicationProcessing` / `processPublication`) executes stages:

- `runPdfToImage`
- `runPageOcr` (for each page)
- `runLeadDetection` (segmentor + classifier)
- `runLeadEnrichment` (article header + person/company names)

4. Canonical state remains in Convex tables (`publications`, `publicationPages`, `pageOcr`, `leads`, `leadEnrichments`, `jobs`, `jobEvents`).
5. Editor page `/publications/:id` supports:

- zoomable page view
- AI/manual lead overlays
- drawing manual missed leads
- OCR rectangle text copy from persisted `pageOcr.wordBoxes`

## Pipeline Stages and Status

`publications.status` transitions:

- `PAGE_PROCESSING`
- `PROCESS_PAGE_ERROR`
- `LEAD_PROCESSING`
- `PROCESS_LEAD_ERROR`
- `NO_LEADS_FOUND`
- `LEADS_FOUND`
- `CONFIRMED`

Retry is available via `retryPublication` action. Jobs and stage logs are persisted via `jobs` + `jobEvents`.

## Crawler Integration Points

- Action: `crawler.ingestCrawlerPublication`
- Mutation: `crawler.markCrawlerBatchVisible`
- HTTP webhook: `POST /crawler/ingest` (token via `TGN_CRAWLER_WEBHOOK_TOKEN`)

This keeps existing crawler systems external while ingesting into the new Convex model.

## PDF Conversion Endpoint

PDF split/render now runs in the Python pipeline service (memory-safe page chunks):

- `POST /api/pipeline/pdf/analyze` with `{ pdf_url }` -> `{ page_count }`
- `POST /api/pipeline/pdf/process` with
  `{ pdf_url, upload_urls, start_page, end_page }` -> `{ results }`

`convex/publications/publicationActions.ts` calls these endpoints via `PIPELINE_SERVICE_URL`.

## Python Pipeline Proxy (Single Public Entry Point)

Nuxt now exposes a proxy for the Python service:

- `GET/POST /api/pipeline/<path>`
- Examples:
  - `POST /api/pipeline/pdf/analyze`
  - `POST /api/pipeline/pdf/process`
  - `GET /api/pipeline/health`
  - `POST /api/pipeline/ocr/page`
  - `POST /api/pipeline/segment/page`
  - `POST /api/pipeline/classify/lead`
  - `POST /api/pipeline/enrich/lead`

Nuxt runtime env:

- `PIPELINE_SERVICE_URL=https://<python-service-domain>`
- `PIPELINE_SERVICE_API_KEY=<python-service-api-key>` (optional)
- `PIPELINE_PROXY_API_KEY=<proxy-api-key>` (optional, recommended)

Convex env for pipeline calls:

- `PIPELINE_SERVICE_URL=https://<your-web-domain>/api/pipeline`
- `PIPELINE_SERVICE_API_KEY=<proxy-api-key>` (if proxy auth is enabled)
- `PDF_UPLOAD_BATCH_SIZE=20` (optional, page chunk size)
- `PDF_UPLOAD_MAX_ATTEMPTS=3` (optional, chunk retry attempts)
- `PAGE_MUTATION_CONCURRENCY=8` (optional, parallel Convex page-row writes)
- `PIPELINE_PAGE_CONCURRENCY=2` (optional, parallel page OCR/segment workers)
- `PIPELINE_SEGMENT_CONCURRENCY=4` (optional, parallel segment classify/enrich workers)
- `PIPELINE_HTTP_MAX_ATTEMPTS=2` (optional, retry for pipeline HTTP calls)
- `PIPELINE_HTTP_BACKOFF_BASE_MS=300` (optional, initial retry delay)
- `PIPELINE_HTTP_BACKOFF_MAX_MS=5000` (optional, cap for exponential backoff)
- `PIPELINE_HTTP_BACKOFF_JITTER_PERCENT=20` (optional, +/- jitter percentage on delay)

## Railway: Single Project, Two Services

Use one Railway project with two services from this same repo:

1. `web` service (Nuxt app)

- Dockerfile target: `runner`
- Public URL enabled
- Required env:
  - `SITE_URL=https://<your-web-domain>`
  - `CONVEX_URL=https://<deployment>.convex.cloud`
  - `CONVEX_SITE_URL=https://<deployment>.convex.site`

2. `convex-deploy` service (Convex deployment worker)

- Dockerfile target: `convex-deploy`
- No public URL needed
- Required env:
  - `CONVEX_DEPLOY_KEY=<your-convex-deploy-key>`
- Command: default image command is already `bunx convex deploy --typecheck disable`

## Migration Notes (Old -> New)

- S3 state is removed from system-of-record. All canonical app state is in Convex DB.
- Files move to Convex Files:
- source PDFs -> `publications.publicationFileStorageId`
- page renders -> `publicationPages.pageImageStorageId`
- Publication status model from Java backend maps into `publications.status` unchanged.
- Lead data maps into `leads`:
- AI leads: `category=AI_LEAD`, `source=AI_PIPELINE`
- manual missed leads: `category=MISSED_LEAD`, `source=MANUAL_EDITOR`
- OCR is persisted page-wide in `pageOcr.wordBoxes` to support geometry-based text copy in editor.
- Lead enrichment fields (header/person/company) move to `leadEnrichments` and are independently retryable.
- Crawler compatibility is preserved via ingestion action/webhook and metadata (`sourceType`, `metadata.batchName`, `metadata.externalRefs`).

## Important Constraint

External lambdas may still use S3 internally, but app canonical state must remain Convex DB + Convex Files.

1
