import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { authorize } from "./lib/permissions";

// Generate a short-lived upload URL
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await authorize(ctx, "publication.create");
    return await ctx.storage.generateUploadUrl();
  },
});

// Get file URL for display
export const getUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    await authorize(ctx, "publication.read");
    return await ctx.storage.getUrl(args.storageId);
  },
});

// // Delete a file from storage
// export const deleteFile = mutation({
//   args: { storageId: v.id("_storage") },
//   handler: async (ctx, args) => {
//     await ctx.storage.delete(args.storageId);
//   },
// });
