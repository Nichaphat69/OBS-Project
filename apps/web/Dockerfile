# Multi-stage build for apps/web (Next.js App Router, TypeScript).
# Build context is the repo root (see docker-compose.yml `context: .`) — npm workspaces monorepo.

FROM node:22-alpine AS base
WORKDIR /repo

FROM base AS deps
COPY package.json package-lock.json* ./
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install --workspaces --include-workspace-root

FROM deps AS build
COPY packages/domain packages/domain
COPY apps/web apps/web
# @obs/domain resolves to its dist/ build output, and .dockerignore strips **/dist from the build
# context — so it has to be compiled inside the image before Next can resolve it, same as apps/api.
RUN npm run build --workspace @obs/domain
RUN npm run build --workspace @obs/web

# ── runtime: Next.js standalone output ──
# With `output: 'standalone'` in a monorepo, Next traces the workspace root (found via the root
# lockfile) and emits .next/standalone as a pruned copy of that whole tree, so the entry point
# lands at <standalone>/apps/web/server.js, not at the standalone root itself. static/ and
# public/ are not included by the trace and must be copied in manually at the matching nested
# path. See https://nextjs.org/docs/app/api-reference/config/next-config-js/output
FROM node:22-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
