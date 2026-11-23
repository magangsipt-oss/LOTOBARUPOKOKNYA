# syntax=docker/dockerfile:1
# Builds the React dashboard, then serves it with Caddy (HTTPS + reverse proxy to the backend).
FROM node:22-bookworm-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY counting/package.json counting/
RUN --mount=type=cache,id=eloto-pnpm,target=/pnpm-store \
    pnpm install --filter frontend --frozen-lockfile --store-dir /pnpm-store
COPY frontend ./frontend
RUN pnpm --filter frontend run build

FROM caddy:2.11.9
COPY docker/caddy/ /etc/caddy/
COPY --from=build /app/frontend/dist /srv/www
