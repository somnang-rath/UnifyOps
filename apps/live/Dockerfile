# syntax=docker/dockerfile:1.7
# Build context: prism/ (the pnpm workspace root)
#
# Stub Dockerfile for apps/live (Hocuspocus realtime server, :3100).
# Mirrors the apps/api multi-stage layout.

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
COPY apps/live/package.json apps/live/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter live...

############################
# Build — compile TypeScript
############################
FROM deps AS build
COPY apps/live ./apps/live
RUN pnpm --filter live build
# Produce a self-contained, prod-only deployment in /out
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter live deploy --prod /out

############################
# Runner — minimal node
############################
FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends \
      dumb-init \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
COPY --from=build /out/package.json ./package.json

RUN chown -R node:node /app
USER node

EXPOSE 3100
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
