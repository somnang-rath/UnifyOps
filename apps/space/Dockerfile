# syntax=docker/dockerfile:1.7
# Build context: prism/ (the pnpm workspace root)
#
# apps/space — Next.js Public Space (:3002, basePath /spaces).
# SSR read-only published content. Fetches the API server-side via the runtime
# API_URL env (apps/space/src/lib/public-api.ts), so no NEXT_PUBLIC_* build args
# are baked. space has no @prism/* workspace deps.

############################
# Base — Node + pnpm
############################
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

############################
# Deps — install space + its workspace deps
############################
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/space/package.json apps/space/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter space...

############################
# Build — compile Next.js (standalone)
############################
FROM deps AS build
COPY apps/space ./apps/space
RUN pnpm --filter space build

############################
# Runner — minimal image
############################
FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production
ENV PORT=3002
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# Next standalone output layout (workspace-aware): .next/standalone contains
# server.js + a minimal node_modules + the monorepo tree rooted at
# outputFileTracingRoot; .next/static must be copied alongside it.
# space has no public/ dir, so none is copied.
COPY --from=build /repo/apps/space/.next/standalone ./
COPY --from=build /repo/apps/space/.next/static ./apps/space/.next/static

RUN chown -R node:node /app
USER node

EXPOSE 3002
CMD ["node", "apps/space/server.js"]
