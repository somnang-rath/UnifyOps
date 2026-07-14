# syntax=docker/dockerfile:1.7
# Build context: prism/ (the pnpm workspace root)

############################
# Base — Node + pnpm
############################
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

############################
# Deps — install workspace deps
############################
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/
# web → @prism/{editor,services,ui}; services → types.
COPY packages/editor/package.json packages/editor/
COPY packages/services/package.json packages/services/
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter web...

############################
# Build — compile Next.js (standalone)
############################
FROM deps AS build
COPY packages/editor ./packages/editor
COPY packages/services ./packages/services
COPY packages/types ./packages/types
COPY packages/ui ./packages/ui
COPY apps/web ./apps/web
# NEXT_PUBLIC_* must be baked at build time
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Live collaboration server (Yjs / Hocuspocus). Without this the wiki editor
# can't connect and falls back to a plain read-only textarea.
ARG NEXT_PUBLIC_LIVE_URL=ws://localhost:3100
ENV NEXT_PUBLIC_LIVE_URL=$NEXT_PUBLIC_LIVE_URL
# Public Space origin — used for the wiki "Publish to Space" share link.
ARG NEXT_PUBLIC_SPACE_URL=http://localhost:3002
ENV NEXT_PUBLIC_SPACE_URL=$NEXT_PUBLIC_SPACE_URL
RUN pnpm --filter web build

############################
# Runner — minimal image
############################
FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# Next standalone output layout (workspace-aware):
#   .next/standalone/   <- contains server.js + minimal node_modules + the
#                          monorepo tree rooted at outputFileTracingRoot
#   .next/static/       <- must be copied alongside server.js
#   public/             <- ditto
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

RUN chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
