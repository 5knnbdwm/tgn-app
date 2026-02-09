import { ConvexError, v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { assertBbox, overlaps } from "../model";

type WordBox = { text: string; bbox: number[] };
type Segment = { bbox: number[] };
type PublicationPage = {
  pageNumber: number;
  pageImageStorageId: Id<"_storage">;
  pageWidth: number;
  pageHeight: number;
};
type PipelineResult = { createdLeadCount: number };
type PageResult =
  | { ok: true; createdLeadCount: number; pageNumber: number }
  | { ok: false; createdLeadCount: number; pageNumber: number; error: string };

function getPositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getPercentEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
    ? parsed
    : fallback;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function getPipelineServiceConfig() {
  const baseUrl = process.env.PIPELINE_SERVICE_URL;
  if (!baseUrl) {
    throw new ConvexError("Missing PIPELINE_SERVICE_URL env variable");
  }
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiKey: process.env.PIPELINE_SERVICE_API_KEY,
  };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, concurrency);
  const results: R[] = new Array(items.length);
  let index = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current]!, current);
    }
  });

  await Promise.all(workers);
  return results;
}

async function postPipeline<T>(
  path: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const { baseUrl, apiKey } = getPipelineServiceConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new ConvexError(
      `Pipeline request failed ${baseUrl}${path}: ${response.status} ${response.statusText}`,
    );
  }
  return response.json() as Promise<T>;
}

async function postPipelineWithRetry<T>(
  path: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const attempts = getPositiveIntEnv("PIPELINE_HTTP_MAX_ATTEMPTS", 2);
  const baseDelayMs = getPositiveIntEnv("PIPELINE_HTTP_BACKOFF_BASE_MS", 300);
  const maxDelayMs = getPositiveIntEnv("PIPELINE_HTTP_BACKOFF_MAX_MS", 5000);
  const jitterPercent = getPercentEnv("PIPELINE_HTTP_BACKOFF_JITTER_PERCENT", 20);
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await postPipeline<T>(path, payload);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const exponentialDelay = Math.min(
          maxDelayMs,
          baseDelayMs * 2 ** (attempt - 1),
        );
        const jitterScale = jitterPercent / 100;
        const jitterOffset =
          exponentialDelay * jitterScale * (Math.random() * 2 - 1);
        const delayMs = Math.max(0, Math.round(exponentialDelay + jitterOffset));
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}

function wordsInSegment(
  words: WordBox[],
  bbox: [number, number, number, number],
) {
  return words
    .filter((word) => word.bbox.length === 4)
    .filter((word) => overlaps(assertBbox(word.bbox), bbox))
    .map((word) => word.text)
    .join(" ");
}

async function runPipeline(
  ctx: any,
  publicationId: Id<"publications">,
): Promise<PipelineResult> {
  const pageConcurrency = getPositiveIntEnv("PIPELINE_PAGE_CONCURRENCY", 2);
  const segmentConcurrency = getPositiveIntEnv("PIPELINE_SEGMENT_CONCURRENCY", 4);

  await ctx.runMutation(
    internal.publications.publicationMutations.clearAiLeads,
    {
      publicationId,
    },
  );
  await ctx.runMutation(
    internal.publications.publicationMutations.updatePublicationStatus,
    { publicationId, status: "LEAD_PROCESSING" },
  );

  const pages = (await ctx.runQuery(
    internal.publications.publicationQueries.getPublicationPagesInternal,
    { publicationId },
  )) as PublicationPage[];
  const pageResults = await mapWithConcurrency<PublicationPage, PageResult>(
    pages,
    pageConcurrency,
    async (page): Promise<PageResult> => {
      try {
        const imageUrl = await ctx.storage.getUrl(page.pageImageStorageId);
        if (!imageUrl) {
          throw new ConvexError(
            `Could not resolve page image URL for page ${page.pageNumber}`,
          );
        }

        const ocrResult = await postPipelineWithRetry<{
          engine?: string;
          version?: string;
          word_boxes?: Array<{ text: string; bbox: number[] }>;
        }>("/ocr/page", {
          publication_id: publicationId,
          page_number: page.pageNumber,
          image_url: imageUrl,
          page_width: page.pageWidth,
          page_height: page.pageHeight,
        });

        const wordBoxes = (ocrResult.word_boxes ?? []).filter(
          (word) =>
            Array.isArray(word.bbox) &&
            word.bbox.length === 4 &&
            typeof word.text === "string",
        );

        await ctx.runMutation(
          internal.publications.publicationMutations.upsertPageOcr,
          {
            publicationId,
            pageNumber: page.pageNumber,
            engine:
              ocrResult.engine === "TEXTRACT" || ocrResult.engine === "OTHER"
                ? ocrResult.engine
                : "TESSERACT",
            version: ocrResult.version,
            wordBoxes,
            plainText: wordBoxes.map((word) => word.text).join(" "),
          },
        );

        const segmentResult = await postPipelineWithRetry<{
          segments?: Segment[];
        }>("/segment/page", {
          publication_id: publicationId,
          page_number: page.pageNumber,
          image_url: imageUrl,
          page_width: page.pageWidth,
          page_height: page.pageHeight,
          word_boxes: wordBoxes,
        });

        const segments = (segmentResult.segments ?? []).filter(
          (segment) => Array.isArray(segment.bbox) && segment.bbox.length === 4,
        );

        const segmentLeadCounts = await mapWithConcurrency<Segment, number>(
          segments,
          segmentConcurrency,
          async (segment): Promise<number> => {
            const bbox = assertBbox(segment.bbox);
            const segmentText = wordsInSegment(wordBoxes, bbox);
            const classifyResult = await postPipelineWithRetry<{
              is_lead: boolean;
              confidence?: number;
              prediction?: "positive" | "negative";
            }>("/classify/lead", {
              publication_id: publicationId,
              page_number: page.pageNumber,
              segment_bbox: bbox,
              text: segmentText,
            });

            if (!classifyResult.is_lead) return 0;

            const leadId = await ctx.runMutation(
              internal.publications.publicationMutations.createAiLead,
              {
                publicationId,
                pageNumber: page.pageNumber,
                bbox,
                confidenceScore: Math.max(
                  0,
                  Math.min(
                    100,
                    Math.round((classifyResult.confidence ?? 0.5) * 100),
                  ),
                ),
                prediction: classifyResult.prediction ?? "positive",
              },
            );

            await ctx.runMutation(
              internal.publications.publicationMutations.upsertLeadEnrichment,
              {
                leadId,
                status: "PROCESSING",
              },
            );

            try {
              const enrichment = await postPipelineWithRetry<{
                article_header?: string;
                person_names?: string[];
                company_names?: string[];
              }>("/enrich/lead", {
                publication_id: publicationId,
                page_number: page.pageNumber,
                segment_bbox: bbox,
                text: segmentText,
              });

              await ctx.runMutation(
                internal.publications.publicationMutations.upsertLeadEnrichment,
                {
                  leadId,
                  status: "DONE",
                  articleHeader: enrichment.article_header,
                  personNames: enrichment.person_names ?? [],
                  companyNames: enrichment.company_names ?? [],
                },
              );
            } catch (error) {
              await ctx.runMutation(
                internal.publications.publicationMutations.upsertLeadEnrichment,
                {
                  leadId,
                  status: "ERROR",
                  errorMessage:
                    error instanceof Error
                      ? error.message
                      : "Lead enrichment failed",
                },
              );
            }

            return 1;
          },
        );

        return {
          ok: true as const,
          createdLeadCount: segmentLeadCounts.reduce(
            (sum: number, n: number) => sum + n,
            0,
          ),
          pageNumber: page.pageNumber,
        };
      } catch (error) {
        console.error("[pipeline] page processing failed", {
          publicationId,
          pageNumber: page.pageNumber,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          ok: false as const,
          createdLeadCount: 0,
          pageNumber: page.pageNumber,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  const createdLeadCount = pageResults.reduce(
    (sum: number, pageResult: PageResult) => sum + pageResult.createdLeadCount,
    0,
  );

  await ctx.runMutation(
    internal.publications.publicationMutations.finalizeLeadProcessing,
    { publicationId },
  );

  const failedPages = pageResults.filter((page: PageResult) => !page.ok);
  if (failedPages.length > 0) {
    throw new ConvexError(
      `Failed processing ${failedPages.length}/${pageResults.length} pages`,
    );
  }

  return { createdLeadCount };
}

export const runPublicationPipelineInternal = internalAction({
  args: {
    publicationId: v.id("publications"),
  },
  handler: async (ctx, args): Promise<PipelineResult> => {
    try {
      return await runPipeline(ctx, args.publicationId);
    } catch (error) {
      await ctx.runMutation(
        internal.publications.publicationMutations.updatePublicationStatus,
        { publicationId: args.publicationId, status: "PROCESS_LEAD_ERROR" },
      );
      throw error;
    }
  },
});
