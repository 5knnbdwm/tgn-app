import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readBody } from "h3";
import { AnalyzeRequest, assertApiKey, fetchPdfBuffer } from "./_shared";

export default defineEventHandler(async (event) => {
  assertApiKey(event);
  const body = await readBody<AnalyzeRequest>(event);
  const pdfBytes = await fetchPdfBuffer(body.pdfUrl);

  const document = await getDocument({ data: pdfBytes, disableWorker: true }).promise;
  return { pageCount: document.numPages };
});
