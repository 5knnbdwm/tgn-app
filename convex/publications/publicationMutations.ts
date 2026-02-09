import { v } from "convex/values";
import { internalMutation, mutation } from "../_generated/server";
import {
  nowTs,
  publicationStatusValidator,
  type PublicationStatus,
  type SourceType,
} from "../model";
import { internal } from "../_generated/api";

function derivePublicationName(fileName: string) {
  return fileName.replace(/\.[^/.]+$/, "").trim();
}

export const createPublicationUpload = mutation({
  args: {
    fileStorageId: v.id("_storage"),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    const fileMeta = await ctx.db.system.get("_storage", args.fileStorageId);
    if (!fileMeta) {
      throw new Error("File not found");
    }

    const ts = nowTs();
    const publicationName = derivePublicationName(args.fileName);
    const createdPublication = await ctx.db.insert("publications", {
      name: args.fileName,
      metadata: {
        publicationName,
      },
      status: "PAGE_PROCESSING" as PublicationStatus,
      sourceType: "PDF" as SourceType,
      publicationFileStorageId: args.fileStorageId,
      publicationFileMimeType: fileMeta.contentType || "",
      publicationFileSize: fileMeta.size,
      pageCount: 0,
      numberOfLeads: 0,
      processPageAttempt: 0,
      createdAt: ts,
      updatedAt: ts,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.publications.publicationActions.enqueuePublicationProcessing,
      {
        publicationId: createdPublication,
        storageId: args.fileStorageId,
      },
    );
    return createdPublication;
  },
});

export const updatePublicationStatus = internalMutation({
  args: {
    publicationId: v.id("publications"),
    status: publicationStatusValidator,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.publicationId, {
      status: args.status,
      updatedAt: nowTs(),
    });
    return true;
  },
});

export const createPublicationPage = internalMutation({
  args: {
    publicationId: v.id("publications"),
    pageNumber: v.number(),
    pageImageStorageId: v.id("_storage"),
    pageWidth: v.number(),
    pageHeight: v.number(),
  },
  handler: async (ctx, args) => {
    const publication = await ctx.db.get(args.publicationId);
    if (!publication) {
      throw new Error("Publication not found");
    }

    const createdPublicationPage = await ctx.db.insert("publicationPages", {
      publicationId: args.publicationId,
      pageNumber: args.pageNumber,
      pageImageStorageId: args.pageImageStorageId,
      pageWidth: args.pageWidth,
      pageHeight: args.pageHeight,
      createdAt: nowTs(),
    });

    return createdPublicationPage;
  },
});

export const setPublicationPageStats = internalMutation({
  args: {
    publicationId: v.id("publications"),
    pageCount: v.number(),
    maxPageWidth: v.number(),
    maxPageHeight: v.number(),
    pageImageStorageIds: v.array(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.publicationId, {
      pageCount: args.pageCount,
      maxPageWidth: args.maxPageWidth,
      maxPageHeight: args.maxPageHeight,
      pageImageStorageIds: args.pageImageStorageIds,
      updatedAt: nowTs(),
    });
    return true;
  },
});

export const upsertPageOcr = internalMutation({
  args: {
    publicationId: v.id("publications"),
    pageNumber: v.number(),
    engine: v.union(
      v.literal("TESSERACT"),
      v.literal("TEXTRACT"),
      v.literal("OTHER"),
    ),
    version: v.optional(v.string()),
    wordBoxes: v.array(v.object({ text: v.string(), bbox: v.array(v.number()) })),
    plainText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pageOcr")
      .withIndex("by_publicationId_pageNumber", (q) =>
        q.eq("publicationId", args.publicationId).eq("pageNumber", args.pageNumber),
      )
      .first();
    const payload = {
      publicationId: args.publicationId,
      pageNumber: args.pageNumber,
      engine: args.engine,
      version: args.version,
      wordBoxes: args.wordBoxes,
      plainText: args.plainText,
      createdAt: nowTs(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }
    return ctx.db.insert("pageOcr", payload);
  },
});

export const clearAiLeads = internalMutation({
  args: {
    publicationId: v.id("publications"),
  },
  handler: async (ctx, args) => {
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_publicationId", (q) => q.eq("publicationId", args.publicationId))
      .collect();
    await Promise.all(
      leads
        .filter((lead) => lead.category === "AI_LEAD")
        .map((lead) => ctx.db.patch(lead._id, { isDeleted: true, updatedAt: nowTs() })),
    );
    return true;
  },
});

export const createAiLead = internalMutation({
  args: {
    publicationId: v.id("publications"),
    pageNumber: v.number(),
    bbox: v.array(v.number()),
    confidenceScore: v.number(),
    prediction: v.union(v.literal("positive"), v.literal("negative")),
  },
  handler: async (ctx, args) => {
    const leadId = await ctx.db.insert("leads", {
      publicationId: args.publicationId,
      pageNumber: args.pageNumber,
      bbox: args.bbox,
      category: "AI_LEAD",
      confidenceScore: args.confidenceScore,
      prediction: args.prediction,
      source: "AI_PIPELINE",
      isDeleted: false,
      createdAt: nowTs(),
      updatedAt: nowTs(),
    });
    return leadId;
  },
});

export const upsertLeadEnrichment = internalMutation({
  args: {
    leadId: v.id("leads"),
    status: v.union(
      v.literal("PENDING"),
      v.literal("PROCESSING"),
      v.literal("DONE"),
      v.literal("ERROR"),
    ),
    articleHeader: v.optional(v.string()),
    personNames: v.optional(v.array(v.string())),
    companyNames: v.optional(v.array(v.string())),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("leadEnrichments")
      .withIndex("by_leadId", (q) => q.eq("leadId", args.leadId))
      .first();
    const ts = nowTs();
    const payload = {
      status: args.status,
      articleHeader: args.articleHeader,
      personNames: args.personNames,
      companyNames: args.companyNames,
      errorMessage: args.errorMessage,
      startedAt: args.status === "PROCESSING" ? ts : undefined,
      completedAt: args.status === "DONE" || args.status === "ERROR" ? ts : undefined,
      updatedAt: ts,
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }
    return ctx.db.insert("leadEnrichments", {
      leadId: args.leadId,
      ...payload,
      createdAt: ts,
    });
  },
});

export const finalizeLeadProcessing = internalMutation({
  args: {
    publicationId: v.id("publications"),
  },
  handler: async (ctx, args) => {
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_publicationId", (q) => q.eq("publicationId", args.publicationId))
      .collect();
    const activeLeadCount = leads.filter((lead) => !lead.isDeleted).length;
    await ctx.db.patch(args.publicationId, {
      numberOfLeads: activeLeadCount,
      status: activeLeadCount > 0 ? "LEADS_FOUND" : "NO_LEADS_FOUND",
      leadObtainedAt: nowTs(),
      updatedAt: nowTs(),
    });
    return activeLeadCount;
  },
});

export const retryPublicationProcessing = mutation({
  args: {
    publicationId: v.id("publications"),
  },
  handler: async (ctx, args) => {
    const publication = await ctx.db.get(args.publicationId);
    if (!publication) {
      throw new Error("Publication not found");
    }

    if (publication.status === "PROCESS_PAGE_ERROR") {
      await ctx.db.patch(args.publicationId, {
        status: "PAGE_PROCESSING",
        processPageAttempt: publication.processPageAttempt + 1,
        errorCode: undefined,
        errorMessage: undefined,
        updatedAt: nowTs(),
      });
      await ctx.scheduler.runAfter(
        0,
        internal.publications.publicationActions.enqueuePublicationProcessing,
        {
          publicationId: args.publicationId,
          storageId: publication.publicationFileStorageId,
        },
      );
      return { queued: true, status: "PAGE_PROCESSING" as PublicationStatus };
    }

    if (publication.status === "PROCESS_LEAD_ERROR") {
      await ctx.db.patch(args.publicationId, {
        status: "LEAD_PROCESSING",
        errorCode: undefined,
        errorMessage: undefined,
        updatedAt: nowTs(),
      });
      await ctx.scheduler.runAfter(
        0,
        internal.pipeline.pipelineActions.runPublicationPipelineInternal,
        {
          publicationId: args.publicationId,
        },
      );
      return { queued: true, status: "LEAD_PROCESSING" as PublicationStatus };
    }

    return { queued: false, status: publication.status };
  },
});
