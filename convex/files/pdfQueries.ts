// import { query, mutation } from "./_generated/server";
// import { v } from "convex/values";
// import { getAuthUserId } from "@convex-dev/auth/server";

// export const generateUploadUrl = mutation({
//   handler: async (ctx) => {
//     const userId = await getAuthUserId(ctx);
//     if (!userId) {
//       throw new Error("User must be authenticated");
//     }
//     return await ctx.storage.generateUploadUrl();
//   },
// });

// export const listDocuments = query({
//   handler: async (ctx) => {
//     const userId = await getAuthUserId(ctx);
//     if (!userId) {
//       return [];
//     }

//     const documents = await ctx.db
//       .query("pdfDocuments")
//       .filter((q) => q.eq(q.field("createdBy"), userId))
//       .order("desc")
//       .collect();

//     return documents;
//   },
// });

// export const getDocumentPages = query({
//   args: { documentId: v.id("pdfDocuments") },
//   handler: async (ctx, args) => {
//     const userId = await getAuthUserId(ctx);
//     if (!userId) {
//       throw new Error("User must be authenticated");
//     }

//     // Verify user owns this document
//     const document = await ctx.db.get(args.documentId);
//     if (!document || document.createdBy !== userId) {
//       throw new Error("Document not found or access denied");
//     }

//     const pages = await ctx.db
//       .query("pdfPages")
//       .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
//       .collect();

//     // Get image URLs for each page
//     const pagesWithUrls = await Promise.all(
//       pages.map(async (page) => ({
//         ...page,
//         imageUrl: await ctx.storage.getUrl(page.imageFileId),
//       }))
//     );

//     // Sort by page number
//     return pagesWithUrls.sort((a, b) => a.pageNumber - b.pageNumber);
//   },
// });

// export const deleteDocument = mutation({
//   args: { documentId: v.id("pdfDocuments") },
//   handler: async (ctx, args) => {
//     const userId = await getAuthUserId(ctx);
//     if (!userId) {
//       throw new Error("User must be authenticated");
//     }

//     // Verify user owns this document
//     const document = await ctx.db.get(args.documentId);
//     if (!document || document.createdBy !== userId) {
//       throw new Error("Document not found or access denied");
//     }

//     // Delete all pages
//     const pages = await ctx.db
//       .query("pdfPages")
//       .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
//       .collect();

//     for (const page of pages) {
//       await ctx.db.delete(page._id);
//       // Note: We're not deleting the actual image files from storage
//       // You might want to add that functionality if storage space is a concern
//     }

//     // Delete the document
//     await ctx.db.delete(args.documentId);
//   },
// });
