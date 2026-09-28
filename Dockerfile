# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: install all deps (incl. dev) and compile TypeScript.
# Build tools are only needed here in case a prebuilt native binary (for
# @discordjs/opus) isn't available for the target platform and npm falls
# back to compiling from source.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies so stage 2 only copies what's actually needed.
RUN npm prune --omit=dev


# ---------------------------------------------------------------------------
# Stage 2: minimal runtime image.
# ffmpeg is required both for yt-dlp's audio extraction and for
# @discordjs/voice's transcoding of the downloaded mp3 into Opus. node is
# required in PATH as the JS runtime yt-dlp uses to solve YouTube's
# player-JS challenges (see YT_DLP_EXTRA_ARGS / --js-runtimes node).
# python3 is required too: the yt-dlp binary youtube-dl-exec downloads is
# invoked via a `/usr/bin/env python3` shebang, so without it every yt-dlp
# call fails immediately with exit code 127.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# The temp/ download-play-delete working directory. It's declared as a
# volume so it never bakes into (or bloats) an image layer — files written
# at runtime live in the volume/bind-mount configured by docker-compose.yml,
# not in the container's writable layer, and `docker build` never touches it.
# node:*-bookworm-slim already ships a non-root "node" user (uid/gid 1000),
# so we reuse it instead of creating a new one.
RUN mkdir -p /app/temp && chown -R node:node /app
VOLUME ["/app/temp"]

USER node

ENV NODE_ENV=production
ENV TEMP_DIR=/app/temp

CMD ["node", "dist/index.js"]
