import { fromBuffer } from "pdf2pic";
import { createError, readBody } from "h3";
import sharp from "sharp";
import type { ProcessRequest } from "./_shared";
import { assertApiKey, fetchPdfBuffer } from "./_shared";

export default defineEventHandler(async (event) => {
  const startedAt = Date.now();
  assertApiKey(event);
  const body = await readBody<ProcessRequest>(event);
  console.info("[pdf/process] request received", {
    pdfUrl: body.pdfUrl,
    uploadUrlCount: Array.isArray(body.uploadUrls) ? body.uploadUrls.length : 0,
  });

  const pdfBytes = await fetchPdfBuffer(body.pdfUrl);
  const pdfBuffer = Buffer.from(pdfBytes);

  if (!Array.isArray(body.uploadUrls) || body.uploadUrls.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Invalid request body: uploadUrls must be a non-empty array.",
    });
  }

  const convert = fromBuffer(pdfBuffer, {
    density: 150,
    format: "png",
    width: 1200,
    preserveAspectRatio: true,
  });

  const images = await convert.bulk(-1, { responseType: "buffer" });
  console.info("[pdf/process] pages rendered", { pageCount: images.length });
  if (body.uploadUrls.length < images.length) {
    throw createError({
      statusCode: 400,
      statusMessage: "uploadUrls must contain at least one URL per PDF page.",
    });
  }

  const results = (
    await Promise.all(
      images.map(async (img, i) => {
        if (!img.buffer) return null;

        const webp = await sharp(img.buffer)
          .resize(1200, null, {
            withoutEnlargement: true,
            fit: "inside",
          })
          .webp({ quality: 85 })
          .toBuffer();
        console.info("[pdf/process] converted page to webp", {
          page: i + 1,
          webpBytes: webp.length,
        });

        const metadata = await sharp(webp).metadata();
        if (!metadata.width || !metadata.height) return null;

        const uploadResponse = await fetch(body.uploadUrls[i], {
          method: "POST",
          headers: { "content-type": "image/webp" },
          body: webp,
        });

        if (!uploadResponse.ok) {
          const message = await uploadResponse.text();
          throw createError({
            statusCode: 502,
            statusMessage: `Upload failed for page ${i + 1}: ${message}`,
          });
        }

        const json = (await uploadResponse.json()) as { storageId?: string };
        if (!json.storageId) {
          throw createError({
            statusCode: 502,
            statusMessage: `Upload succeeded for page ${i + 1} but returned no storageId.`,
          });
        }

        console.info("[pdf/process] uploaded page", {
          page: i + 1,
          storageId: json.storageId,
          width: metadata.width,
          height: metadata.height,
        });

        return {
          storageId: json.storageId,
          width: metadata.width,
          height: metadata.height,
          page: i + 1,
        };
      }),
    )
  ).filter((row): row is NonNullable<typeof row> => row !== null);

  console.info("[pdf/process] completed", {
    processedPages: results.length,
    durationMs: Date.now() - startedAt,
  });

  return { results };
});
