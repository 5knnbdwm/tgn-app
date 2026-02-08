import { createError, getHeader, type H3Event } from "h3";

export type AnalyzeRequest = { pdfUrl: string };
export type ProcessRequest = {
  pdfUrl: string;
  uploadUrls: string[];
};

function getConfiguredApiKey() {
  return process.env.PDF_SERVICE_API_KEY?.trim();
}

export function assertApiKey(event: H3Event) {
  const configuredApiKey = getConfiguredApiKey();
  if (!configuredApiKey) return;

  const apiKeyHeader = getHeader(event, "x-api-key");
  if (apiKeyHeader === configuredApiKey) return;

  throw createError({
    statusCode: 401,
    statusMessage: "Unauthorized. Invalid or missing API key.",
  });
}

export async function fetchPdfBuffer(pdfUrl: string) {
  if (!pdfUrl || typeof pdfUrl !== "string") {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid request body: pdfUrl is required.",
    });
  }

  const response = await fetch(pdfUrl);
  if (!response.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: `Could not fetch PDF (${response.status} ${response.statusText}).`,
    });
  }

  return Buffer.from(await response.arrayBuffer());
}
