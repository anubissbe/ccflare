# syntax=docker/dockerfile:1.7

ARG BUN_VERSION=1.2.8

FROM oven/bun:${BUN_VERSION} AS builder
WORKDIR /app

# Copy workspace manifests first for better layer caching
COPY package.json bun.lock tsconfig.json biome.json ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile
RUN bun run build:dashboard

FROM oven/bun:${BUN_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production \
	XDG_CONFIG_HOME=/data \
	ccflare_CONFIG_PATH=/data/config/ccflare.json \
	ccflare_DB_PATH=/data/storage/ccflare.db \
	PORT=8080

# System dependencies for health checks
RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bun.lock ./bun.lock
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/biome.json ./biome.json
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/packages ./packages

RUN bun install --frozen-lockfile --production

RUN mkdir -p /data/config /data/storage

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
	CMD curl -fsS "http://127.0.0.1:${PORT}/api/stats" >/dev/null || exit 1

ENTRYPOINT ["bun", "run", "server"]
