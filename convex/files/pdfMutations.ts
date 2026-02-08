// import { internalMutation } from "./_generated/server";
// import { v } from "convex/values";

// export const createDocument = internalMutation({
//   args: {
//     name: v.string(),
//     originalFileId: v.id("_storage"),
//     createdBy: v.id("users"),
//   },
//   handler: async (ctx, args) => {
//     return await ctx.db.insert("pdfDocuments", {
//       name: args.name,
//       originalFileId: args.originalFileId,
//       totalPages: 0,
//       status: "processing",
//       createdBy: args.createdBy,
//     });
//   },
// });

// export const createPage = internalMutation({
//   args: {
//     documentId: v.id("pdfDocuments"),
//     pageNumber: v.number(),
//     imageFileId: v.id("_storage"),
//   },
//   handler: async (ctx, args) => {
//     return await ctx.db.insert("pdfPages", {
//       documentId: args.documentId,
//       pageNumber: args.pageNumber,
//       imageFileId: args.imageFileId,
//     });
//   },
// });

// export const updateDocumentStatus = internalMutation({
//   args: {
//     documentId: v.id("pdfDocuments"),
//     totalPages: v.number(),
//     status: v.union(
//       v.literal("processing"),
//       v.literal("completed"),
//       v.literal("failed"),
//     ),
//   },
//   handler: async (ctx, args) => {
//     await ctx.db.patch(args.documentId, {
//       totalPages: args.totalPages,
//       status: args.status,
//     });
//   },
// });
