function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

export default defineEventHandler(async (event) => {
  const path = event.context.params?.path || "";
  const method = event.method;
  const config = useRuntimeConfig(event);
  const proxyApiKey = config.pipelineProxyApiKey;
  const baseUrl = trimTrailingSlash(config.pipelineServiceUrl);

  if (baseUrl.length === 0) {
    console.error(`[pipeline/proxy] Missing pipeline service URL`);
    throw createError({
      statusCode: 500,
      message: "Missing pipeline service URL",
    });
  }

  if (proxyApiKey.length === 0) {
    console.error(`[pipeline/proxy] Missing pipeline proxy API key`);
    throw createError({
      statusCode: 500,
      message: "Missing pipeline proxy API key",
    });
  }

  const apiKey = getHeader(event, "x-api-key");
  if (apiKey !== proxyApiKey) {
    console.error(`[pipeline/proxy] Unauthorized request to /${path}`);
    throw createError({ statusCode: 401, message: "Invalid API key" });
  }

  const upstreamUrl = `${baseUrl}/${path}`;

  console.log(`[pipeline/proxy] ${method} /${path}`);

  try {
    return await proxyRequest(event, upstreamUrl);
  } catch (error) {
    console.error(`[pipeline/proxy] Error proxying to ${upstreamUrl}:`, error);
    throw createError({
      statusCode: 502,
      message: "Upstream service error",
    });
  }
});
