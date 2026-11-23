# syntax=docker/dockerfile:1
# E-LOTO backend API (Express + sharp). Build from the repository root:
#   docker compose build backend
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TZ=Asia/Makassar
RUN corepack enable

WORKDIR /app
# Workspace manifests first so dependency layers are reused when only code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY counting/package.json counting/
RUN --mount=type=cache,id=eloto-pnpm,target=/pnpm-store \
    pnpm install --prod --filter backend --frozen-lockfile --store-dir /pnpm-store

COPY backend ./backend
# Upload folders become named volumes; Docker seeds them from the image on first use.
RUN mkdir -p backend/uploads/user_profiles backend/legacy-uploads \
 && chown -R node:node backend/uploads backend/legacy-uploads

USER node
WORKDIR /app/backend
EXPOSE 5002
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:5002/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server.js"]
