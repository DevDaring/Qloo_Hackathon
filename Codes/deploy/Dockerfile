# LaunchLens image: FastAPI API + durable worker (same code, different command),
# with FFmpeg, libraqm (Indic text shaping) and the bundled Noto fonts.
# Build from the repository root:  docker build -f deploy/Dockerfile -t launchlens .

FROM node:20.18-bookworm-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm AS app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libraqm0 libfribidi0 libharfbuzz0b curl \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 launchlens
WORKDIR /app
COPY backend/requirements.lock backend/requirements.lock
RUN pip install -r backend/requirements.lock
COPY backend/ backend/
COPY assets/ assets/
COPY deploy/provider-pricing.json deploy/provider-pricing.json
COPY --from=web /web/dist frontend/dist
RUN mkdir -p /data/assets && chown -R launchlens /data /app
USER launchlens
ENV LOCAL_ASSET_DIR=/data/assets FONT_ASSET_DIR=/app/assets/fonts PROVIDER_PRICING_FILE=/app/deploy/provider-pricing.json
WORKDIR /app/backend
EXPOSE 8140
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fsS http://127.0.0.1:8140/health/live || exit 1
# API by default; the worker service overrides the command.
CMD ["uvicorn", "launchlens.main:app", "--host", "0.0.0.0", "--port", "8140", "--proxy-headers", "--forwarded-allow-ips=*"]
