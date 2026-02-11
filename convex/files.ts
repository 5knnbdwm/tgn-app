import { query } from "./_generated/server";
import { v } from "convex/values";
import { authorize } from "./lib/permissions";
import { r2 } from "./r2";
export { generateUploadUrl, syncMetadata } from "./r2";

// Get signed file URL for display/download
export const getUrl = query({
  args: {
    key: v.string(),
    expiresIn: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await authorize(ctx, "publication.read");
    return await r2.getUrl(args.key, {
      expiresIn: args.expiresIn,
    });
  },
});
