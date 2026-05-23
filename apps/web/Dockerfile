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
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

############################
# Build — compile Next.js (standalone)
############################
FROM deps AS build
COPY apps/web ./apps/web
# NEXT_PUBLIC_* must be baked at build time
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
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
