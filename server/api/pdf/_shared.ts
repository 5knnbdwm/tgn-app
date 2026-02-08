import { createError, getHeader, type H3Event } from "h3";

export type AnalyzeRequest = { pdfUrl: string };
export type ProcessRequest = {
  pdfUrl: string;
  uploadUrls: string[];
};

export function assertApiKey(event: H3Event) {
  const { pdfServiceApiKey: configuredApiKey } = useRuntimeConfig(event);
  if (!configuredApiKey?.trim()) return;

  const apiKeyHeader = getHeader(event, "x-api-key");
  if (apiKeyHeader === configuredApiKey) return;

  throw createError({
    statusCode: 401,
    statusMessage: "Unauthorized. Invalid or missing API key.",
  });
}

export async function fetchPdfBuffer(pdfUrl: string): Promise<Uint8Array> {
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

  return new Uint8Array(await response.arrayBuffer());
}
