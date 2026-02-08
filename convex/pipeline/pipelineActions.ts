import { ConvexError, v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { assertBbox, overlaps } from "../model";

type WordBox = { text: string; bbox: number[] };
type Segment = { bbox: number[] };

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
      `Pipeline request failed ${path}: ${response.status} ${response.statusText}`,
    );
  }
  return response.json() as Promise<T>;
}

function wordsInSegment(words: WordBox[], bbox: [number, number, number, number]) {
  return words
    .filter((word) => word.bbox.length === 4)
    .filter((word) => overlaps(assertBbox(word.bbox), bbox))
    .map((word) => word.text)
    .join(" ");
}

async function runPipeline(ctx: any, publicationId: any) {
  await ctx.runMutation(internal.publications.publicationMutations.clearAiLeads, {
    publicationId,
  });
  await ctx.runMutation(
    internal.publications.publicationMutations.updatePublicationStatus,
    { publicationId, status: "LEAD_PROCESSING" },
  );

  const pages = await ctx.runQuery(
    internal.publications.publicationQueries.getPublicationPagesInternal,
    { publicationId },
  );
  let createdLeadCount = 0;

  for (const page of pages) {
    const imageUrl = await ctx.storage.getUrl(page.pageImageStorageId);
    if (!imageUrl) {
      throw new ConvexError(`Could not resolve page image URL for page ${page.pageNumber}`);
    }

    const ocrResult = await postPipeline<{
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

    const wordBoxes = (ocrResult.word_boxes ?? []).filter((word) =>
      Array.isArray(word.bbox) && word.bbox.length === 4 && typeof word.text === "string",
    );

    await ctx.runMutation(internal.publications.publicationMutations.upsertPageOcr, {
      publicationId,
      pageNumber: page.pageNumber,
      engine:
        ocrResult.engine === "TEXTRACT" || ocrResult.engine === "OTHER"
          ? ocrResult.engine
          : "TESSERACT",
      version: ocrResult.version,
      wordBoxes,
      plainText: wordBoxes.map((word) => word.text).join(" "),
    });

    const segmentResult = await postPipeline<{ segments?: Segment[] }>("/segment/page", {
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

    for (const segment of segments) {
      const bbox = assertBbox(segment.bbox);
      const segmentText = wordsInSegment(wordBoxes, bbox);
      const classifyResult = await postPipeline<{
        is_lead: boolean;
        confidence?: number;
        prediction?: "positive" | "negative";
      }>("/classify/lead", {
        publication_id: publicationId,
        page_number: page.pageNumber,
        segment_bbox: bbox,
        text: segmentText,
      });

      if (!classifyResult.is_lead) continue;

      const leadId = await ctx.runMutation(
        internal.publications.publicationMutations.createAiLead,
        {
          publicationId,
          pageNumber: page.pageNumber,
          bbox,
          confidenceScore: Math.max(
            0,
            Math.min(100, Math.round((classifyResult.confidence ?? 0.5) * 100)),
          ),
          prediction: classifyResult.prediction ?? "positive",
        },
      );
      createdLeadCount += 1;

      await ctx.runMutation(
        internal.publications.publicationMutations.upsertLeadEnrichment,
        {
          leadId,
          status: "PROCESSING",
        },
      );

      try {
        const enrichment = await postPipeline<{
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
              error instanceof Error ? error.message : "Lead enrichment failed",
          },
        );
      }
    }
  }

  await ctx.runMutation(
    internal.publications.publicationMutations.finalizeLeadProcessing,
    { publicationId },
  );

  return { createdLeadCount };
}

export const runPublicationPipeline = action({
  args: {
    publicationId: v.id("publications"),
  },
  handler: async (ctx, args) => runPipeline(ctx, args.publicationId),
});

export const runPublicationPipelineInternal = internalAction({
  args: {
    publicationId: v.id("publications"),
  },
  handler: async (ctx, args) => {
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
