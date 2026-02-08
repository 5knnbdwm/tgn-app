FROM oven/bun:1 AS builder
WORKDIR /app

# Install dependencies first for better Docker layer caching.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build Nuxt Nitro server output.
COPY . .
ENV NUXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM oven/bun:1 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NUXT_TELEMETRY_DISABLED=1
ENV HOST=0.0.0.0
ENV PORT=3000

# Copy node_modules from builder (already installed, no need to reinstall)
COPY --from=builder /app/node_modules ./node_modules

# Copy the built output
COPY --from=builder /app/.output ./.output

EXPOSE 3000
CMD ["bun", ".output/server/index.mjs"]
