FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages packages
COPY services services
COPY catalog/learner-review.json catalog/learner-review.json
RUN npm ci --no-audit --no-fund
RUN npm run typecheck -w @keyspilli/transcribe || true

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV KEYSPILLI_DATA_DIR=/data
ENV KEYSPILLI_PYTHON=/app/.venv/bin/python
ENV PATH="/app/.venv/bin:$PATH"
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services ./services
COPY --from=build /app/catalog/learner-review.json ./catalog/learner-review.json
COPY package.json tsconfig.base.json ./
RUN python3 -m venv /app/.venv \
    && /app/.venv/bin/pip install --no-cache-dir --quiet "setuptools<81" "numpy<2" "scipy<1.13" librosa mir_eval pretty_midi resampy scikit-learn typing_extensions onnxruntime yt-dlp \
    && /app/.venv/bin/pip install --no-cache-dir --quiet --no-deps basic-pitch
VOLUME /data
CMD ["node", "--import", "tsx", "services/transcribe/src/worker.ts"]
