# ── Stage 1: Build ────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=optional

# Copy source and build
COPY tsconfig.json tsconfig.json
COPY prisma/ prisma/
COPY src/ src/
RUN npm run build

# Prune dev dependencies for production
RUN npm ci --omit=dev --omit=optional

# ── Stage 2: Production runtime ────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Security: run as non-root
RUN addgroup -g 1001 -S pamoja && \
    adduser -S pamoja -u 1001 -G pamoja

# Copy production deps and build output
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

# Copy entrypoint
COPY scripts/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER pamoja

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/v1/health',r=>{process.exit(r.statusCode===200?0:1)})"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
