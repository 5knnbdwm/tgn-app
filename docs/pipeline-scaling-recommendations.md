# Pipeline Scaling Recommendations

This document captures the initial recommendations for scaling publication ingestion to hundreds of PDFs (10-500 pages each), and breaks them into thread-sized work items.

## Initial Risks Identified

1. PDF split/render memory pressure
- Full-document rendering in one request can spike RAM and timeout on large PDFs.

2. Slow throughput from serial processing
- Page and segment processing done sequentially creates long end-to-end latency and backlog growth.

3. Very high request volume
- OCR + segmentation + classification + enrichment per page/segment can produce very large HTTP call counts.

4. Coarse failure behavior
- A single failing page can fail the whole publication run, making retries expensive.

5. Storage/cost growth
- Storing source PDFs + all page images + OCR + lead/enrichment data increases storage and transfer costs quickly.

6. Bulk ingestion operability gaps
- Missing explicit batch controls, observability, and controlled retry strategy for large ingestion events.

## What Was Implemented Already

1. Moved PDF analyze/process to Python pipeline.
2. Added chunked page processing for PDF split/upload.
3. Added bounded concurrency for key pipeline loops.
4. Added retry wrappers for external pipeline HTTP calls.
5. Removed Nuxt PDF endpoints and removed direct PDF split deps from app package.

## Remaining Work (Thread Backlog)

### Thread 1: Per-page Retry Queue
Goal: Retry only failed pages, not entire publications.

Tasks:
- Add a `publicationPageJobs` table with `QUEUED/RUNNING/DONE/ERROR`, attempts, and error metadata.
- Split lead processing into page-job actions.
- Add retry action for failed page jobs.
- Keep publication status derived from aggregate page-job state.

Acceptance:
- One bad page does not force full publication rerun.
- Retries are scoped to failed pages only.

### Thread 2: Backpressure and Global Rate Limits
Goal: Protect upstream pipeline services and stabilize throughput.

Tasks:
- Add configurable global concurrency tokens (pages and segment calls).
- Add request pacing/jitter for classify/enrich bursts.
- Add per-publication caps so one large doc cannot starve others.

Acceptance:
- Predictable processing rate under large batch load.
- No sustained error spikes from upstream rate limiting.

### Thread 3: Durable Progress + Resume
Goal: Make long runs resumable and crash-safe.

Tasks:
- Persist last completed page per publication stage.
- Make stage handlers idempotent.
- On restart/retry, continue from checkpoint.

Acceptance:
- Service restart does not lose completed work.
- Re-runs do not duplicate leads/enrichments.

### Thread 4: Observability and SLOs
Goal: Make scale behavior measurable.

Tasks:
- Emit per-stage metrics (latency, success/failure counts, retries).
- Add structured logs with publication/page correlation ids.
- Build basic dashboard/query for queue depth, p95 latency, and error rate.

Acceptance:
- Can answer: queue depth, throughput, p95 stage time, and failure hotspots.

### Thread 5: Storage and Retention Policy
Goal: Control long-term storage costs.

Tasks:
- Define retention for intermediate artifacts (optionally purge page images after OCR if safe).
- Add archive tier strategy for old publications.
- Add cleanup job with dry-run mode.

Acceptance:
- Storage growth curve is bounded and forecastable.

### Thread 6: Bulk Ingestion UX and Controls
Goal: Make large uploads manageable operationally.

Tasks:
- Add CSV/manifest batch ingest endpoint.
- Show ingest batch progress and failures.
- Add cancel/pause/resume controls at batch level.

Acceptance:
- Operators can run large imports without manual per-file workflows.

## Suggested Priority

1. Thread 1 (Per-page retry queue)
2. Thread 2 (Backpressure/rate limits)
3. Thread 4 (Observability)
4. Thread 3 (Resume/checkpointing)
5. Thread 5 (Retention)
6. Thread 6 (Bulk UX)
