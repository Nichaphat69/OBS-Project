# Multi-stage build for apps/api (Express + TypeScript + Prisma).
# Build context is the repo root (see docker-compose.yml `context: .`) because this is an npm
# workspaces monorepo — the api package depends on the sibling @obs/db and @obs/domain packages.

FROM node:22-alpine AS base
WORKDIR /repo
# node:22-alpine ships libssl3 but not the `openssl` CLI — Prisma's engine-binary version
# detection shells out to `openssl version` to pick the right prebuilt engine, and silently
# falls back to a wrong openssl-1.1.x binary when that command is missing (which then fails to
# load at runtime with a "Could not parse schema engine response" error). Installing the CLI
# fixes detection for both `prisma generate` (build stage) and `prisma migrate deploy` (runtime).
RUN apk add --no-cache openssl

# ── deps: install the whole workspace once, cached across builds ──
FROM base AS deps
COPY package.json package-lock.json* ./
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install --workspaces --include-workspace-root

# ── build: generate the Prisma client and compile TypeScript ──
FROM deps AS build
COPY packages/db packages/db
COPY packages/domain packages/domain
COPY apps/api apps/api
RUN npm run generate --workspace @obs/db
RUN npm run build --workspace @obs/domain
RUN npm run build --workspace @obs/api

# ── runtime: slim image with only what's needed to run the compiled server ──
FROM node:22-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production
# same reason as the `base` stage above — `prisma migrate deploy` runs in THIS image at
# container start, so it needs the `openssl` CLI here too, not just in the build stage.
RUN apk add --no-cache openssl
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/db ./packages/db
COPY --from=build /repo/packages/domain ./packages/domain
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json

EXPOSE 4301
WORKDIR /repo/apps/api
# ใช้ Prisma client จาก packages/db ที่ generate ไว้แล้วตอน build — รัน migrate deploy ก่อนเปิดเซิร์ฟเวอร์
# ทุกครั้งที่คอนเทนเนอร์เริ่ม (idempotent — ไม่มี migration ใหม่ก็ผ่านเฉยๆ)
CMD ["sh", "-c", "npx prisma migrate deploy --schema ../../packages/db/prisma/schema.prisma && node dist/server.js"]
