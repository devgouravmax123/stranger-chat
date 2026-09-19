# ==========================================
# Backend Production Multi-stage Dockerfile
# ==========================================

# 1. Dependencies and build stage
FROM node:22-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app

# Install all dependencies (including devDependencies required for build)
COPY package.json package-lock.json ./
RUN npm ci

# Copy Prisma schema and generate client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy source code and build NestJS
COPY . .
RUN npm run build

# Prune development dependencies for lean production container
RUN npm prune --production

# 2. Production runtime stage
FROM node:22-alpine AS runner
RUN apk add --no-cache openssl curl
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Non-root user for security
RUN addgroup --system --gid 1001 nestjs && \
    adduser --system --uid 1001 nestjs

# Copy pruned dependencies, generated Prisma client, and built artifacts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/dist ./dist

USER nestjs

EXPOSE 3001

HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

CMD ["node", "dist/src/main.js"]
