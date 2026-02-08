import {
  createError,
  getHeader,
  getMethod,
  getQuery,
  getRouterParam,
  readRawBody,
  setResponseStatus,
} from "h3";

function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  const baseUrl = trimTrailingSlash((config.pipelineServiceUrl ?? "").trim());
  if (!baseUrl) {
    throw createError({
      statusCode: 500,
      statusMessage: "Missing PIPELINE_SERVICE_URL runtime config.",
    });
  }

  const proxyApiKey = (config.pipelineProxyApiKey ?? "").trim();
  if (proxyApiKey) {
    const incomingApiKey = getHeader(event, "x-api-key");
    if (incomingApiKey !== proxyApiKey) {
      throw createError({
        statusCode: 401,
        statusMessage: "Unauthorized. Invalid or missing API key.",
      });
    }
  }

  const method = getMethod(event);
  const pathParam = getRouterParam(event, "path");
  const path = Array.isArray(pathParam)
    ? pathParam.filter(Boolean).join("/")
    : (pathParam ?? "");
  if (!path) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing pipeline path.",
    });
  }

  const query = new URLSearchParams(
    Object.entries(getQuery(event))
      .filter(([, value]) => value !== undefined && value !== null)
      .flatMap(([key, value]) =>
        Array.isArray(value)
          ? value.map((v) => [key, String(v)] as [string, string])
          : [[key, String(value)] as [string, string]],
      ),
  );
  const upstreamUrl = `${baseUrl}/${path}${query.size ? `?${query}` : ""}`;

  const upstreamApiKey = (config.pipelineServiceApiKey ?? "").trim();
  const contentType = getHeader(event, "content-type");
  const accept = getHeader(event, "accept");
  const body =
    method === "GET" || method === "HEAD" ? undefined : await readRawBody(event);

  const response = await fetch(upstreamUrl, {
    method,
    headers: {
      ...(contentType ? { "content-type": contentType } : {}),
      ...(accept ? { accept } : {}),
      ...(upstreamApiKey
        ? { "x-api-key": upstreamApiKey }
        : getHeader(event, "x-api-key")
          ? { "x-api-key": getHeader(event, "x-api-key") as string }
          : {}),
    },
    body,
  });

  const responseContentType = response.headers.get("content-type") ?? "";
  setResponseStatus(event, response.status, response.statusText);
  if (responseContentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
});
