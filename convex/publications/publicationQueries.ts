import { v } from "convex/values";
import { internalQuery, query } from "../_generated/server";
import { paginationOptsValidator } from "convex/server";
import { publicationStatusValidator, sourceTypeValidator } from "../model";
import { authorize } from "../lib/permissions";

export const listPublications = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(publicationStatusValidator),
    sourceType: v.optional(sourceTypeValidator),
    ownerUserId: v.optional(v.id("users")),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await authorize(ctx, "publication.read");

    return await ctx.db
      .query("publications")
      .order("desc")
      .filter((q) => {
        if (args.status && !q.eq(q.field("status"), args.status)) return false;
        if (args.sourceType && !q.eq(q.field("sourceType"), args.sourceType))
          return false;
        if (args.ownerUserId && !q.eq(q.field("ownerUserId"), args.ownerUserId))
          return false;
        if (args.search && !q.eq(q.field("name"), args.search.toLowerCase()))
          return false;
        return true;
      })
      .paginate(args.paginationOpts);
  },
});

export const getPublication = query({
  args: {
    id: v.id("publications"),
  },
  handler: async (ctx, args) => {
    await authorize(ctx, "publication.read");
    return await ctx.db.get(args.id);
  },
});

export const getPage = query({
  args: {
    publicationId: v.id("publications"),
    pageNumber: v.number(),
  },
  handler: async (ctx, args) => {
    await authorize(ctx, "publication.read");

    const page = await ctx.db
      .query("publicationPages")
      .withIndex("by_publicationId_pageNumber", (q) =>
        q
          .eq("publicationId", args.publicationId)
          .eq("pageNumber", args.pageNumber),
      )
      .first();
    if (!page) return null;
    const pageImageUrl = await ctx.storage.getUrl(page.pageImageStorageId);
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_publicationId_pageNumber", (q) =>
        q
          .eq("publicationId", args.publicationId)
          .eq("pageNumber", args.pageNumber),
      )
      .collect();
    const activeLeads = leads
      .filter((lead) => !lead.isDeleted)
      .sort((a, b) => b.confidenceScore - a.confidenceScore);
    return { page, pageImageUrl, leads: activeLeads };
  },
});

export const getEditorSidebar = query({
  args: {
    publicationId: v.id("publications"),
  },
  handler: async (ctx, args) => {
    await authorize(ctx, "publication.read");

    const publication = await ctx.db.get(args.publicationId);
    if (!publication) return null;

    const leads = await ctx.db
      .query("leads")
      .withIndex("by_publicationId", (q) => q.eq("publicationId", args.publicationId))
      .collect();

    const activeLeads = leads
      .filter((lead) => !lead.isDeleted)
      .sort(
        (a, b) =>
          a.pageNumber - b.pageNumber || b.confidenceScore - a.confidenceScore,
      );

    const pages = new Map<number, typeof activeLeads>();

    for (const lead of activeLeads) {
      const pageLeads = pages.get(lead.pageNumber) ?? [];
      pageLeads.push(lead);
      pages.set(lead.pageNumber, pageLeads);
    }

    return {
      publication: {
        _id: publication._id,
        name: publication.name,
        metadata: publication.metadata,
        pageCount: publication.pageCount,
        numberOfLeads: publication.numberOfLeads,
        status: publication.status,
      },
      pagesWithLeads: Array.from(pages.entries())
        .sort(([left], [right]) => left - right)
        .map(([pageNumber, pageLeads]) => ({
          pageNumber,
          leads: pageLeads,
        })),
    };
  },
});

export const getPagesForPublication = query({
  args: {
    publicationId: v.id("publications"),
  },
  handler: async (ctx, args) => {
    await authorize(ctx, "publication.read");

    return await ctx.db
      .query("publicationPages")
      .withIndex("by_publicationId", (q) =>
        q.eq("publicationId", args.publicationId),
      )
      .collect();
  },
});

export const getPageOcr = query({
  args: {
    publicationId: v.id("publications"),
    pageNumber: v.number(),
  },
  handler: async (ctx, args) => {
    await authorize(ctx, "publication.read");

    return ctx.db
      .query("pageOcr")
      .withIndex("by_publicationId_pageNumber", (q) =>
        q
          .eq("publicationId", args.publicationId)
          .eq("pageNumber", args.pageNumber),
      )
      .first();
  },
});

export const getLeadEnrichment = query({
  args: {
    leadId: v.id("leads"),
  },
  handler: async (ctx, args) => {
    await authorize(ctx, "publication.read");

    return ctx.db
      .query("leadEnrichments")
      .withIndex("by_leadId", (q) => q.eq("leadId", args.leadId))
      .first();
  },
});

export const getLeadEnrichmentsForPage = query({
  args: {
    publicationId: v.id("publications"),
    pageNumber: v.number(),
  },
  handler: async (ctx, args) => {
    await authorize(ctx, "publication.read");

    const leads = await ctx.db
      .query("leads")
      .withIndex("by_publicationId_pageNumber", (q) =>
        q
          .eq("publicationId", args.publicationId)
          .eq("pageNumber", args.pageNumber),
      )
      .collect();

    const activeLeads = leads.filter((lead) => !lead.isDeleted);
    const enrichments = await Promise.all(
      activeLeads.map((lead) =>
        ctx.db
          .query("leadEnrichments")
          .withIndex("by_leadId", (q) => q.eq("leadId", lead._id))
          .first(),
      ),
    );

    return enrichments.filter(Boolean);
  },
});

export const getPublicationInternal = internalQuery({
  args: {
    publicationId: v.id("publications"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.publicationId);
  },
});

export const getPublicationPagesInternal = internalQuery({
  args: {
    publicationId: v.id("publications"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("publicationPages")
      .withIndex("by_publicationId", (q) =>
        q.eq("publicationId", args.publicationId),
      )
      .collect();
  },
});
