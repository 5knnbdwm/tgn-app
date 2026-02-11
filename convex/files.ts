import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { authorize } from "./lib/permissions";
import { r2 } from "./r2";
export { generateUploadUrl, syncMetadata } from "./r2";

function getFileExtension(fileName: string) {
  const match = fileName.trim().toLowerCase().match(/(\.[a-z0-9]{1,8})$/);
  return match ? match[1] : "";
}

export const generatePublicationUploadUrl = mutation({
  args: {
    fileName: v.string(),
  },
  returns: v.object({
    key: v.string(),
    url: v.string(),
    prefix: v.string(),
  }),
  handler: async (ctx, args) => {
    await authorize(ctx, "publication.create");

    const prefix = `publications/${Date.now()}-${crypto.randomUUID()}`;
    const key = `${prefix}/source${getFileExtension(args.fileName)}`;
    const signedUpload = await r2.generateUploadUrl(key);

    return {
      key,
      url: signedUpload.url,
      prefix,
    };
  },
});

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
