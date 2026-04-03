# ---- Builder stage: install deps, build Vite SPA ----
FROM node:22-slim AS builder

WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/tsconfig.json apps/web/tsconfig.node.json apps/web/

RUN corepack enable pnpm && pnpm install --frozen-lockfile

# Copy web app source and config files
COPY apps/web/index.html apps/web/
COPY apps/web/vite.config.ts apps/web/
COPY apps/web/tailwind.config.ts apps/web/
COPY apps/web/postcss.config.js apps/web/
COPY apps/web/src apps/web/src/

# Build the Vite SPA — output goes to apps/web/dist
RUN cd apps/web && pnpm exec vite build

# ---- Runtime stage: serve with nginx ----
FROM nginx:1.27-alpine

# Install curl for healthcheck and remove default nginx config
RUN apk add --no-cache curl && rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=5s \
  CMD curl -sf http://localhost:3000/ > /dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
