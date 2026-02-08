import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { readBody } from "h3";
import { AnalyzeRequest, assertApiKey, fetchPdfBuffer } from "./_shared";

if (!globalThis.pdfjsWorker) {
  globalThis.pdfjsWorker = pdfjsWorker as unknown as typeof globalThis.pdfjsWorker;
}

export default defineEventHandler(async (event) => {
  const startedAt = Date.now();
  assertApiKey(event);
  const body = await readBody<AnalyzeRequest>(event);
  console.info("[pdf/analyze] request received", { pdfUrl: body.pdfUrl });
  const pdfBytes = await fetchPdfBuffer(body.pdfUrl);

  const document = await getDocument({ data: pdfBytes }).promise;
  console.info("[pdf/analyze] completed", {
    pageCount: document.numPages,
    durationMs: Date.now() - startedAt,
  });
  return { pageCount: document.numPages };
});
