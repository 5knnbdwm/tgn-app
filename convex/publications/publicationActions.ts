import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

function getPdfServiceBaseUrl() {
  const baseUrl = (process.env.PDF_SERVICE_URL || process.env.SITE_URL || "").trim();
  if (!baseUrl) {
    throw new Error("Missing PDF_SERVICE_URL (or SITE_URL) env variable");
  }
  return baseUrl.replace(/\/$/, "");
}

export const enqueuePublicationProcessing = internalAction({
  args: { storageId: v.id("_storage"), publicationId: v.id("publications") },
  returns: v.array(
    v.object({
      storageId: v.id("_storage"),
      width: v.number(),
      height: v.number(),
      page: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    try {
      const serviceBaseUrl = getPdfServiceBaseUrl();

      // 0. Get publication
      const pdfUrl = await ctx.storage.getUrl(args.storageId);

      if (!pdfUrl) {
        throw new Error("PDF URL not found");
      }

      // 1. Get page count
      const { pageCount } = await fetch(
        `${serviceBaseUrl}/api/pdf/analyze`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": process.env.PDF_SERVICE_API_KEY || "",
          },
          body: JSON.stringify({ pdfUrl }),
        },
      ).then((r) => r.json());

      // 2. Generate upload URLs
      const uploadUrls = await Promise.all(
        Array(pageCount)
          .fill(null)
          .map(async () => await ctx.storage.generateUploadUrl()),
      );

      console.log("uploadUrls", uploadUrls);

      // 3. Process and upload
      const { results } = (await fetch(
        `${serviceBaseUrl}/api/pdf/process`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": process.env.PDF_SERVICE_API_KEY || "",
          },
          body: JSON.stringify({
            pdfUrl,
            uploadUrls,
          }),
        },
      ).then((r) => r.json())) as {
        results: {
          storageId: Id<"_storage">;
          width: number;
          height: number;
          page: number;
        }[];
      };

      console.log("results", results);

      // 4. Create publication pages
      await Promise.all(
        results.map(async (result) => {
          await ctx.runMutation(
            internal.publications.publicationMutations.createPublicationPage,
            {
              publicationId: args.publicationId,
              pageNumber: result.page,
              pageImageStorageId: result.storageId,
              pageWidth: result.width,
              pageHeight: result.height,
            },
          );
        }),
      );

      await ctx.runMutation(
        internal.publications.publicationMutations.setPublicationPageStats,
        {
          publicationId: args.publicationId,
          pageCount: results.length,
          maxPageWidth: Math.max(...results.map((result) => result.width)),
          maxPageHeight: Math.max(...results.map((result) => result.height)),
          pageImageStorageIds: results.map((result) => result.storageId),
        },
      );

      // 5. Update publication status

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

      return results;
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
