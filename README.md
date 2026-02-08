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
PDF_SERVICE_URL=http://localhost:3000
PDF_SERVICE_API_KEY=your-shared-secret
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

Nuxt now provides internal PDF conversion routes:

- `POST /api/pdf/analyze` with `{ pdfUrl }` -> `{ pageCount }`
- `POST /api/pdf/process` with `{ pdfUrl, uploadUrls }` -> `{ results }`

`convex/publications/publicationActions.ts` calls these routes via `PDF_SERVICE_URL` (fallback: `SITE_URL`).
If `PDF_SERVICE_API_KEY` is set, requests must include `X-API-Key`.

## Railway: Single Project, Two Services

Use one Railway project with two services from this same repo:

1. `web` service (Nuxt app)
- Dockerfile target: `runner`
- Public URL enabled
- Required env:
  - `SITE_URL=https://<your-web-domain>`
  - `CONVEX_URL=https://<deployment>.convex.cloud`
  - `CONVEX_SITE_URL=https://<deployment>.convex.site`
  - `PDF_SERVICE_API_KEY=<shared-secret>`

2. `convex-deploy` service (Convex deployment worker)
- Dockerfile target: `convex-deploy`
- No public URL needed
- Required env:
  - `CONVEX_DEPLOY_KEY=<your-convex-deploy-key>`
- Command: default image command is already `bunx convex deploy --typecheck disable`

Also set in Convex deployment env:
- `PDF_SERVICE_URL=https://<your-web-domain>`
- `PDF_SERVICE_API_KEY=<shared-secret>`

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
