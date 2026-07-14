# syntax=docker/dockerfile:1.7
# Build context: prism/ (the pnpm workspace root)
#
# apps/admin — Next.js Instance Admin / God Mode (:3001, basePath /god-mode).
# Mirrors apps/web's standalone layout. No NEXT_PUBLIC_* build args: admin talks
# to the API same-origin via the next.config /api/v1 → API_URL rewrite proxy,
# so the API address is a *runtime* env, not baked into the bundle.

############################
# Base — Node + pnpm
############################
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

############################
# Deps — install admin + its workspace deps
############################
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/admin/package.json apps/admin/
# admin → @prism/{constants,services,types,ui}; services → types.
COPY packages/constants/package.json packages/constants/
COPY packages/services/package.json packages/services/
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter admin...

############################
# Build — compile Next.js (standalone)
############################
FROM deps AS build
COPY packages/constants ./packages/constants
COPY packages/services ./packages/services
COPY packages/types ./packages/types
COPY packages/ui ./packages/ui
COPY apps/admin ./apps/admin
# Next evaluates next.config rewrites() at BUILD time and freezes the result
# into routes-manifest.json — the runtime API_URL env does NOT affect it. So the
# same-origin /api/v1 → API proxy destination must be baked here. Default to the
# compose-internal API address; override via build arg for other topologies.
ARG API_URL=http://api:4000/api/v1
ENV API_URL=$API_URL
RUN pnpm --filter admin build

############################
# Runner — minimal image
############################
FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# Next standalone output layout (workspace-aware): .next/standalone contains
# server.js + a minimal node_modules + the monorepo tree rooted at
# outputFileTracingRoot; .next/static must be copied alongside it. public/
# holds the Unify logo (served under the /god-mode basePath).
COPY --from=build /repo/apps/admin/.next/standalone ./
COPY --from=build /repo/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build /repo/apps/admin/public ./apps/admin/public

RUN chown -R node:node /app
USER node

EXPOSE 3001
CMD ["node", "apps/admin/server.js"]
