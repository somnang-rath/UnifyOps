# syntax=docker/dockerfile:1.7
# Build context: prism/ (the pnpm workspace root)

############################
# Base — Node + pnpm
############################
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PUPPETEER_SKIP_DOWNLOAD=true
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
# Build — compile NestJS
############################
FROM deps AS build
COPY apps/api ./apps/api
RUN pnpm --filter api build
# Produce a self-contained, prod-only deployment in /out
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter api deploy --prod /out

############################
# Runner — Chromium + node
############################
FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Chromium + fonts so puppeteer can render PDFs
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      fonts-noto-color-emoji \
      ca-certificates \
      dumb-init \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
COPY --from=build /out/package.json ./package.json

# Uploads volume (the API writes to ./uploads on disk in some paths)
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node

EXPOSE 4000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
