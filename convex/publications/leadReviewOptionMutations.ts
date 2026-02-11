import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { authorize } from "../lib/permissions";
import { nowTs } from "../model";

const leadReviewDecisionValidator = v.union(
  v.literal("CONFIRMED"),
  v.literal("DENIED"),
);

const defaultLeadReviewOptions: Array<{
  decision: "CONFIRMED" | "DENIED";
  tag: string;
  label: string;
}> = [
  { decision: "CONFIRMED", tag: "ERP_IMPORTED", label: "ERP Imported" },
  { decision: "CONFIRMED", tag: "OTHER", label: "Other" },
  { decision: "DENIED", tag: "WRONG_PREDICTION", label: "Wrong Prediction" },
  { decision: "DENIED", tag: "OTHER", label: "Other" },
];

export const listActiveLeadReviewOptions = query({
  args: {},
  handler: async (ctx) => {
    await authorize(ctx, "publication.read");

    const rows = await ctx.db.query("leadReviewOptions").collect();
    const activeRows = rows
      .filter((row) => row.isActive)
      .sort((a, b) => {
        if (a.decision !== b.decision) {
          return a.decision.localeCompare(b.decision);
        }
        return a.createdAt - b.createdAt;
      });

    return {
      CONFIRMED: activeRows
        .filter((row) => row.decision === "CONFIRMED")
        .map((row) => ({ tag: row.tag, label: row.label })),
      DENIED: activeRows
        .filter((row) => row.decision === "DENIED")
        .map((row) => ({ tag: row.tag, label: row.label })),
    };
  },
});

export const listLeadReviewOptions = query({
  args: {},
  handler: async (ctx) => {
    await authorize(ctx, "lead.review.options.manage");

    const rows = await ctx.db.query("leadReviewOptions").order("asc").collect();
    return rows.sort((a, b) => {
      if (a.decision !== b.decision) {
        return a.decision.localeCompare(b.decision);
      }
      return a.createdAt - b.createdAt;
    });
  },
});

export const upsertLeadReviewOption = mutation({
  args: {
    decision: leadReviewDecisionValidator,
    tag: v.string(),
    label: v.string(),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await authorize(ctx, "lead.review.options.manage");

    const tag = args.tag.trim();
    const label = args.label.trim();
    if (tag.length === 0) {
      throw new Error("Tag is required");
    }
    if (label.length === 0) {
      throw new Error("Label is required");
    }

    const existing = await ctx.db
      .query("leadReviewOptions")
      .withIndex("by_decision_tag", (q) =>
        q.eq("decision", args.decision).eq("tag", tag),
      )
      .first();
    const ts = nowTs();
    const isActive = args.isActive ?? true;

    if (existing) {
      await ctx.db.patch(existing._id, {
        label,
        isActive,
        updatedAt: ts,
      });
      return existing._id;
    }

    return await ctx.db.insert("leadReviewOptions", {
      decision: args.decision,
      tag,
      label,
      isActive,
      createdAt: ts,
      updatedAt: ts,
    });
  },
});

export const setLeadReviewOptionActive = mutation({
  args: {
    optionId: v.id("leadReviewOptions"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    await authorize(ctx, "lead.review.options.manage");
    await ctx.db.patch(args.optionId, {
      isActive: args.isActive,
      updatedAt: nowTs(),
    });
    return true;
  },
});

export const deleteLeadReviewOption = mutation({
  args: {
    optionId: v.id("leadReviewOptions"),
  },
  handler: async (ctx, args) => {
    await authorize(ctx, "lead.review.options.manage");
    await ctx.db.delete(args.optionId);
    return true;
  },
});

export const seedDefaultLeadReviewOptions = mutation({
  args: {},
  handler: async (ctx) => {
    await authorize(ctx, "lead.review.options.manage");

    const existing = await ctx.db.query("leadReviewOptions").collect();
    const existingKeySet = new Set(
      existing.map((row) => `${row.decision}::${row.tag}`),
    );

    const ts = nowTs();
    for (const row of defaultLeadReviewOptions) {
      const key = `${row.decision}::${row.tag}`;
      if (existingKeySet.has(key)) continue;
      await ctx.db.insert("leadReviewOptions", {
        decision: row.decision,
        tag: row.tag,
        label: row.label,
        isActive: true,
        createdAt: ts,
        updatedAt: ts,
      });
    }

    return true;
  },
});
