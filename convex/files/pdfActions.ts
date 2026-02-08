// "use node";

// import { action } from "./_generated/server";
// import { v } from "convex/values";
// import pdf2pic from "pdf2pic";
// import { internal } from "./_generated/api";
// // import { getAuthUserId } from "@convex-dev/auth/server";

// export const processPdfToImages = action({
//   args: {
//     pdfFileId: v.id("_storage"),
//     documentName: v.string(),
//   },
//   handler: async (ctx, args) => {
//     // const userId = await getAuthUserId(ctx);
//     // if (!userId) {
//     //   throw new Error("User must be authenticated");
//     // }

//     // Create document record
//     const documentId: any = await ctx.runMutation(
//       internal.pdfMutations.createDocument,
//       {
//         name: args.documentName,
//         originalFileId: args.pdfFileId,
//         createdBy: userId,
//       },
//     );

//     try {
//       // Get the PDF file from storage
//       const pdfUrl = await ctx.storage.getUrl(args.pdfFileId);
//       if (!pdfUrl) {
//         throw new Error("PDF file not found");
//       }

//       // Fetch the PDF file
//       const response = await fetch(pdfUrl);
//       if (!response.ok) {
//         throw new Error("Failed to fetch PDF file");
//       }

//       const pdfBuffer = Buffer.from(await response.arrayBuffer());

//       // Configure pdf2pic
//       const convert = pdf2pic.fromBuffer(pdfBuffer, {
//         density: 150, // Output resolution
//         saveFilename: "page",
//         savePath: "/tmp",
//         format: "png",
//         width: 800, // Max width
//         height: 1200, // Max height
//       });

//       // Get total pages first
//       const firstPage = await convert(1, { responseType: "buffer" });
//       if (!firstPage.buffer) {
//         throw new Error("Failed to process PDF");
//       }

//       // Process all pages
//       let pageNumber = 1;
//       const pagePromises = [];

//       while (true) {
//         try {
//           const pageResult = await convert(pageNumber, {
//             responseType: "buffer",
//           });
//           if (!pageResult.buffer) {
//             break;
//           }

//           // Upload page image to storage
//           const imageBlob = new Blob([pageResult.buffer], {
//             type: "image/png",
//           });
//           const imageFileId = await ctx.storage.store(imageBlob);

//           // Save page record
//           pagePromises.push(
//             ctx.runMutation(internal.pdfMutations.createPage, {
//               documentId,
//               pageNumber,
//               imageFileId,
//             }),
//           );

//           pageNumber++;
//         } catch (error) {
//           // If we can't process this page, we've likely reached the end
//           break;
//         }
//       }

//       // Wait for all pages to be saved
//       await Promise.all(pagePromises);

//       // Update document with total pages and completion status
//       await ctx.runMutation(internal.pdfMutations.updateDocumentStatus, {
//         documentId,
//         totalPages: pageNumber - 1,
//         status: "completed",
//       });

//       return {
//         documentId,
//         totalPages: pageNumber - 1,
//         message: `Successfully converted PDF to ${pageNumber - 1} images`,
//       };
//     } catch (error) {
//       // Mark document as failed
//       await ctx.runMutation(internal.pdfMutations.updateDocumentStatus, {
//         documentId,
//         totalPages: 0,
//         status: "failed",
//       });

//       throw new Error(`Failed to process PDF: ${(error as Error).message}`);
//     }
//   },
// });
