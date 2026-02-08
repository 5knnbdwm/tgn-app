import { v } from "convex/values";
import { internalQuery, query } from "../_generated/server";
import { paginationOptsValidator } from "convex/server";
import { publicationStatusValidator, sourceTypeValidator } from "../model";

export const listPublications = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(publicationStatusValidator),
    sourceType: v.optional(sourceTypeValidator),
    ownerUserId: v.optional(v.id("users")),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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
    return await ctx.db.get(args.id);
  },
});

export const getPage = query({
  args: {
    publicationId: v.id("publications"),
    pageNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("publicationPages")
      .withIndex("by_publicationId_pageNumber", (q) =>
        q
          .eq("publicationId", args.publicationId)
          .eq("pageNumber", args.pageNumber),
      )
      .first();
    if (!page) return null;
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_publicationId_pageNumber", (q) =>
        q
          .eq("publicationId", args.publicationId)
          .eq("pageNumber", args.pageNumber),
      )
      .collect();
    return { page, leads: leads.filter((lead) => !lead.isDeleted) };
  },
});

export const getPagesForPublication = query({
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

export const getPageOcr = query({
  args: {
    publicationId: v.id("publications"),
    pageNumber: v.number(),
  },
  handler: async (ctx, args) => {
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
    return ctx.db
      .query("leadEnrichments")
      .withIndex("by_leadId", (q) => q.eq("leadId", args.leadId))
      .first();
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
