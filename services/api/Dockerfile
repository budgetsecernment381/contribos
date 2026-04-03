# ---- Builder stage: install deps, generate Prisma client, compile TS ----
FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY services/api/package.json services/api/tsconfig.json services/api/

# Copy Prisma schema (needed for generate)
COPY services/api/prisma services/api/prisma/

RUN corepack enable pnpm && pnpm install --frozen-lockfile

# Copy source and compile
COPY services/api/src services/api/src/
RUN cd services/api && pnpm exec prisma generate && pnpm exec tsc -b

# Deploy: creates a self-contained directory with all production deps
RUN pnpm deploy --filter @contribos/api --prod /app/deploy

# Copy compiled output and prisma schema into deploy
RUN cp -r services/api/dist /app/deploy/dist && \
    cp -r services/api/prisma /app/deploy/prisma

# Re-generate Prisma client inside the deploy directory using the
# builder's installed prisma v6 (not npx which pulls latest v7)
RUN PRISMA_BIN=$(find /app/node_modules/.pnpm -path "*/prisma/build/index.js" | head -1) && \
    cd /app/deploy && node "$PRISMA_BIN" generate --schema=prisma/schema.prisma


# ---- Runtime stage: minimal image ----
FROM node:22-slim

RUN apt-get update && apt-get install -y openssl wget && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 contribos && \
    useradd --system --uid 1001 --gid contribos contribos

WORKDIR /app

# Copy the self-contained deploy output
COPY --from=builder /app/deploy ./

RUN chown -R contribos:contribos /app

USER contribos

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -q -O- http://localhost:3001/api/v1/health || exit 1

CMD ["node", "dist/server.js"]
