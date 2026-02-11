import { v } from "convex/values";
import { internalMutation, mutation } from "../_generated/server";
import {
  nowTs,
  publicationStatusValidator,
  type PublicationStatus,
  type SourceType,
} from "../model";
import { internal } from "../_generated/api";
import { authorize } from "../lib/permissions";
import { r2 } from "../r2";

function derivePublicationName(fileName: string) {
  return fileName.replace(/\.[^/.]+$/, "").trim();
}

export const createPublicationUpload = mutation({
  args: {
    fileKey: v.string(),
    fileName: v.string(),
    fileMimeType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await authorize(ctx, "publication.create");

    const ts = nowTs();
    const publicationName = derivePublicationName(args.fileName);
    const createdPublication = await ctx.db.insert("publications", {
      name: args.fileName,
      metadata: {
        publicationName,
      },
      status: "PAGE_PROCESSING" as PublicationStatus,
      sourceType: "PDF" as SourceType,
      publicationFileKey: args.fileKey,
      publicationFileMimeType: args.fileMimeType || "application/pdf",
      publicationFileSize: args.fileSize || 0,
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
        fileKey: args.fileKey,
      },
    );
    return createdPublication;
  },
});

export const createMissedLead = mutation({
  args: {
    publicationId: v.id("publications"),
    pageNumber: v.number(),
    bbox: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await authorize(ctx, "lead.manual.create");

    const publication = await ctx.db.get(args.publicationId);
    if (!publication) {
      throw new Error("Publication not found");
    }

    if (args.pageNumber < 1 || args.pageNumber > publication.pageCount) {
      throw new Error("Invalid page number");
    }

    if (args.bbox.length !== 4) {
      throw new Error("bbox must have 4 coordinates");
    }
    const [x1, y1, x2, y2] = args.bbox as [number, number, number, number];
    if (
      ![x1, y1, x2, y2].every(Number.isFinite) ||
      x2 <= x1 ||
      y2 <= y1
    ) {
      throw new Error("Invalid bbox");
    }

    const ts = nowTs();
    const leadId = await ctx.db.insert("leads", {
      publicationId: args.publicationId,
      pageNumber: args.pageNumber,
      bbox: args.bbox,
      category: "MISSED_LEAD",
      confidenceScore: 100,
      prediction: "positive",
      source: "MANUAL_EDITOR",
      createdByUserId: user._id,
      isDeleted: false,
      createdAt: ts,
      updatedAt: ts,
    });

    const leads = await ctx.db
      .query("leads")
      .withIndex("by_publicationId", (q) =>
        q.eq("publicationId", args.publicationId),
      )
      .collect();
    const activeLeadCount = leads.filter((lead) => !lead.isDeleted).length;
    await ctx.db.patch(args.publicationId, {
      numberOfLeads: activeLeadCount,
      status: "LEADS_FOUND",
      leadObtainedAt: ts,
      updatedAt: ts,
    });

    return leadId;
  },
});

export const reviewAiLead = mutation({
  args: {
    leadId: v.id("leads"),
    decision: v.union(
      v.literal("CONFIRMED"),
      v.literal("DENIED"),
      v.literal("CLEAR"),
    ),
    tag: v.optional(v.string()),
    tagReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await authorize(ctx, "lead.ai.review");

    const lead = await ctx.db.get(args.leadId);
    if (!lead) {
      throw new Error("Lead not found");
    }
    if (lead.isDeleted) {
      throw new Error("Lead is deleted");
    }
    if (lead.category !== "AI_LEAD") {
      throw new Error("Only AI leads can be reviewed");
    }

    const ts = nowTs();

    const decision = args.decision;

    if (decision === "CLEAR") {
      await ctx.db.patch(args.leadId, {
        reviewStatus: undefined,
        reviewedByUserId: undefined,
        reviewedAt: undefined,
        tag: undefined,
        tagReason: undefined,
        updatedAt: ts,
      });
      return true;
    }

    if (!args.tag) {
      throw new Error("A review option must be selected");
    }

    const activeOptions = await ctx.db
      .query("leadReviewOptions")
      .withIndex("by_decision", (q) => q.eq("decision", decision))
      .collect();
    const hasTag = activeOptions.some(
      (option) => option.isActive && option.tag === args.tag,
    );
    if (!hasTag) {
      throw new Error("Invalid review option for selected decision");
    }

    await ctx.db.patch(args.leadId, {
      reviewStatus: decision,
      reviewedByUserId: user._id,
      reviewedAt: ts,
      tag: args.tag,
      tagReason: args.tag === "OTHER" ? args.tagReason?.trim() : undefined,
      updatedAt: ts,
    });

    return true;
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

export const updatePublicationMetadata = internalMutation({
  args: {
    publicationId: v.id("publications"),
    publicationName: v.optional(v.string()),
    publicationDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const publication = await ctx.db.get(args.publicationId);
    if (!publication) {
      throw new Error("Publication not found");
    }

    const metadata = { ...(publication.metadata ?? {}) };
    let hasChanges = false;

    if (typeof args.publicationName === "string") {
      const nextName = args.publicationName.trim();
      if (nextName.length > 0 && metadata.publicationName !== nextName) {
        metadata.publicationName = nextName;
        hasChanges = true;
      }
    }

    if (typeof args.publicationDate === "string") {
      const nextDate = args.publicationDate.trim();
      if (nextDate.length > 0 && metadata.publicationDate !== nextDate) {
        metadata.publicationDate = nextDate;
        hasChanges = true;
      }
    }

    if (!hasChanges) return false;

    await ctx.db.patch(args.publicationId, {
      metadata,
      updatedAt: nowTs(),
    });
    return true;
  },
});

export const createPublicationPage = internalMutation({
  args: {
    publicationId: v.id("publications"),
    pageNumber: v.number(),
    pageImageKey: v.string(),
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
      pageImageKey: args.pageImageKey,
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
    pageImageKeys: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.publicationId, {
      pageCount: args.pageCount,
      maxPageWidth: args.maxPageWidth,
      maxPageHeight: args.maxPageHeight,
      pageImageKeys: args.pageImageKeys,
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
    wordBoxes: v.array(
      v.object({ text: v.string(), bbox: v.array(v.number()) }),
    ),
    plainText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pageOcr")
      .withIndex("by_publicationId_pageNumber", (q) =>
        q
          .eq("publicationId", args.publicationId)
          .eq("pageNumber", args.pageNumber),
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
      .withIndex("by_publicationId", (q) =>
        q.eq("publicationId", args.publicationId),
      )
      .collect();
    await Promise.all(
      leads
        .filter((lead) => lead.category === "AI_LEAD")
        .map((lead) =>
          ctx.db.patch(lead._id, { isDeleted: true, updatedAt: nowTs() }),
        ),
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
    articleHeaderBbox: v.optional(v.array(v.number())),
    personNames: v.optional(v.array(v.string())),
    personNameBoxes: v.optional(
      v.array(
        v.object({
          name: v.string(),
          bbox: v.array(v.number()),
        }),
      ),
    ),
    companyNames: v.optional(v.array(v.string())),
    companyNameBoxes: v.optional(
      v.array(
        v.object({
          name: v.string(),
          bbox: v.array(v.number()),
        }),
      ),
    ),
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
      articleHeaderBbox: args.articleHeaderBbox,
      personNames: args.personNames,
      personNameBoxes: args.personNameBoxes,
      companyNames: args.companyNames,
      companyNameBoxes: args.companyNameBoxes,
      errorMessage: args.errorMessage,
      startedAt: args.status === "PROCESSING" ? ts : undefined,
      completedAt:
        args.status === "DONE" || args.status === "ERROR" ? ts : undefined,
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
      .withIndex("by_publicationId", (q) =>
        q.eq("publicationId", args.publicationId),
      )
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
    await authorize(ctx, "publication.retry");

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
          fileKey: publication.publicationFileKey,
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

export const resetPublicationPages = internalMutation({
  args: {
    publicationId: v.id("publications"),
  },
  handler: async (ctx, args) => {
    const pages = await ctx.db
      .query("publicationPages")
      .withIndex("by_publicationId", (q) =>
        q.eq("publicationId", args.publicationId),
      )
      .collect();
    await Promise.all(pages.map((page) => ctx.db.delete(page._id)));

    const pageOcrRows = await ctx.db
      .query("pageOcr")
      .withIndex("by_publicationId", (q) =>
        q.eq("publicationId", args.publicationId),
      )
      .collect();
    await Promise.all(pageOcrRows.map((row) => ctx.db.delete(row._id)));

    await ctx.db.patch(args.publicationId, {
      pageCount: 0,
      maxPageWidth: undefined,
      maxPageHeight: undefined,
      pageImageKeys: undefined,
      updatedAt: nowTs(),
    });
    return true;
  },
});

export const deletePublication = mutation({
  args: {
    publicationId: v.id("publications"),
  },
  handler: async (ctx, args) => {
    await authorize(ctx, "publication.delete");

    const publication = await ctx.db.get(args.publicationId);
    if (!publication) {
      throw new Error("Publication not found");
    }

    const pages = await ctx.db
      .query("publicationPages")
      .withIndex("by_publicationId", (q) =>
        q.eq("publicationId", args.publicationId),
      )
      .collect();

    const fileKeys = new Set<string>([
      publication.publicationFileKey,
      ...(publication.pageImageKeys ?? []),
      ...pages.map((page) => page.pageImageKey),
    ]);

    await Promise.allSettled(
      Array.from(fileKeys)
        .filter((key) => key.length > 0)
        .map((key) => r2.deleteObject(ctx, key)),
    );

    const pageOcrRows = await ctx.db
      .query("pageOcr")
      .withIndex("by_publicationId", (q) =>
        q.eq("publicationId", args.publicationId),
      )
      .collect();
    await Promise.all(pageOcrRows.map((row) => ctx.db.delete(row._id)));

    const leads = await ctx.db
      .query("leads")
      .withIndex("by_publicationId", (q) =>
        q.eq("publicationId", args.publicationId),
      )
      .collect();

    await Promise.all(
      leads.map(async (lead) => {
        const enrichment = await ctx.db
          .query("leadEnrichments")
          .withIndex("by_leadId", (q) => q.eq("leadId", lead._id))
          .first();
        if (enrichment) {
          await ctx.db.delete(enrichment._id);
        }
        await ctx.db.delete(lead._id);
      }),
    );

    await Promise.all(pages.map((page) => ctx.db.delete(page._id)));
    await ctx.db.delete(args.publicationId);

    return { deleted: true };
  },
});
