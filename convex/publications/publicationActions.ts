import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { r2 } from "../r2";

type PdfProcessResult = {
  storage_key: string;
  width: number;
  height: number;
  page: number;
};

function getPipelineServiceConfig() {
  const baseUrl = (process.env.PIPELINE_SERVICE_URL || "").trim();
  if (!baseUrl) {
    throw new Error("Missing PIPELINE_SERVICE_URL env variable");
  }
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiKey: process.env.PIPELINE_SERVICE_API_KEY || "",
  };
}

function getPositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
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
    const body = await response.text();
    throw new Error(
      `Pipeline request failed ${path}: ${response.status} ${response.statusText} ${body}`,
    );
  }
  return response.json() as Promise<T>;
}

async function withRetry<T>(
  label: string,
  maxAttempts: number,
  fn: () => Promise<T>,
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        console.warn(`[publication/pdf] ${label} failed attempt ${attempt}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        await sleep(attempt * 500);
        continue;
      }
    }
  }
  throw lastError;
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<void>,
) {
  const limit = Math.max(1, concurrency);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      await mapper(items[current]!, current);
    }
  });
  await Promise.all(workers);
}

export const enqueuePublicationProcessing = internalAction({
  args: { fileKey: v.string(), publicationId: v.id("publications") },
  returns: v.array(
    v.object({
      key: v.string(),
      width: v.number(),
      height: v.number(),
      page: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    try {
      const pdfUrl = await r2.getUrl(args.fileKey, {
        expiresIn: 60 * 60,
      });

      const chunkSize = getPositiveIntEnv("PDF_UPLOAD_BATCH_SIZE", 20);
      const maxAttempts = getPositiveIntEnv("PDF_UPLOAD_MAX_ATTEMPTS", 3);
      const pageMutationConcurrency = getPositiveIntEnv(
        "PAGE_MUTATION_CONCURRENCY",
        8,
      );

      const analyze = await withRetry("analyze", maxAttempts, () =>
        postPipeline<{ page_count?: number; pageCount?: number }>(
          "/pdf/analyze",
          { pdf_url: pdfUrl },
        ),
      );
      const pageCount = analyze.page_count ?? analyze.pageCount ?? 0;
      if (!Number.isInteger(pageCount) || pageCount < 0) {
        throw new Error(`Invalid page count returned: ${pageCount}`);
      }

      const results: {
        key: string;
        width: number;
        height: number;
        page: number;
      }[] = [];

      for (let startPage = 1; startPage <= pageCount; startPage += chunkSize) {
        const endPage = Math.min(pageCount, startPage + chunkSize - 1);
        const expectedChunkPages = endPage - startPage + 1;
        const uploads = await Promise.all(
          Array.from(
            { length: expectedChunkPages },
            async () => await r2.generateUploadUrl(),
          ),
        );

        const processedChunk = await withRetry(
          `process ${startPage}-${endPage}`,
          maxAttempts,
          () =>
            postPipeline<{ results: PdfProcessResult[] }>("/pdf/process", {
              pdf_url: pdfUrl,
              uploads,
              start_page: startPage,
              end_page: endPage,
            }),
        );

        if (processedChunk.results.length !== expectedChunkPages) {
          throw new Error(
            `Chunk ${startPage}-${endPage} returned ${processedChunk.results.length} pages, expected ${expectedChunkPages}`,
          );
        }

        for (const row of processedChunk.results) {
          results.push({
            key: row.storage_key,
            width: row.width,
            height: row.height,
            page: row.page,
          });
        }
      }

      const sortedResults = [...results].sort((a, b) => a.page - b.page);
      await mapWithConcurrency(
        sortedResults,
        pageMutationConcurrency,
        async (result) => {
          await ctx.runMutation(
            internal.publications.publicationMutations.createPublicationPage,
            {
              publicationId: args.publicationId,
              pageNumber: result.page,
              pageImageKey: result.key,
              pageWidth: result.width,
              pageHeight: result.height,
            },
          );
        },
      );

      await ctx.runMutation(
        internal.publications.publicationMutations.setPublicationPageStats,
        {
          publicationId: args.publicationId,
          pageCount: sortedResults.length,
          maxPageWidth:
            sortedResults.length > 0
              ? Math.max(...sortedResults.map((result) => result.width))
              : 0,
          maxPageHeight:
            sortedResults.length > 0
              ? Math.max(...sortedResults.map((result) => result.height))
              : 0,
          pageImageKeys: sortedResults.map((result) => result.key),
        },
      );

      await ctx.runMutation(
        internal.publications.publicationMutations.updatePublicationStatus,
        {
          publicationId: args.publicationId,
          status: "LEAD_PROCESSING",
        },
      );

      await ctx.scheduler.runAfter(
        0,
        internal.pipeline.pipelineActions.runPublicationPipelineInternal,
        {
          publicationId: args.publicationId,
        },
      );

      return sortedResults;
    } catch (error) {
      console.error("Error processing publication", error);
      await ctx.runMutation(
        internal.publications.publicationMutations.updatePublicationStatus,
        {
          publicationId: args.publicationId,
          status: "PROCESS_PAGE_ERROR",
        },
      );
      throw new Error("Error processing publication");
    }
  },
});
