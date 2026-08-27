FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages packages
COPY services services
COPY catalog/manifest.json catalog/manifest.json
COPY catalog/learner-review.json catalog/learner-review.json
COPY catalog/transcription-overrides.json catalog/transcription-overrides.json
COPY catalog/chord-sources.json catalog/chord-sources.json
COPY catalog/chord-timelines catalog/chord-timelines
# better-sqlite3 normally downloads a prebuilt binary. Keep the fallback path
# deterministic when that download is unavailable (for example, a transient
# ECONNRESET in CI) by providing the node-gyp toolchain in the build stage.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
ENV npm_config_python=/usr/bin/python3
RUN npm ci --no-audit --no-fund
RUN npm run typecheck -w @keyspilli/transcribe

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV KEYSPILLI_DATA_DIR=/data
ENV KEYSPILLI_PYTHON=/app/.venv/bin/python
ENV KEYSPILLI_IMPORT_MODE=auto
ENV KEYSPILLI_DEMUCS_MODEL=htdemucs_6s
ENV KEYSPILLI_DEMUCS_DEVICE=cpu
ENV KEYSPILLI_STEM_MIN_FREE_GIB=6
ENV TORCH_HOME=/app/.cache/torch
ENV PATH="/app/.venv/bin:$PATH"
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/services ./services
COPY --from=build /app/catalog/manifest.json ./catalog/manifest.json
COPY --from=build /app/catalog/learner-review.json ./catalog/learner-review.json
COPY --from=build /app/catalog/transcription-overrides.json ./catalog/transcription-overrides.json
COPY --from=build /app/catalog/chord-sources.json ./catalog/chord-sources.json
COPY --from=build /app/catalog/chord-timelines ./catalog/chord-timelines
# Use explicit CPU PyTorch wheels; the default Linux index can pull unusable
# CUDA runtimes. Bake the model into the image so jobs do not depend on a
# first-run model download.
COPY package.json tsconfig.base.json ./
# yt-dlp's default extra includes the matching EJS challenge solver. The bare
# package leaves JS runtimes configured but no solver scripts, which makes
# otherwise valid YouTube clients fail signature challenges.
RUN python3 -m venv /app/.venv \
    && /app/.venv/bin/pip install --no-cache-dir --quiet "setuptools<81" "numpy<2" "scipy<1.13" librosa mir_eval pretty_midi resampy scikit-learn typing_extensions onnxruntime "yt-dlp[default]==2026.08.19" \
    && /app/.venv/bin/pip install --no-cache-dir --quiet --no-deps basic-pitch \
    && /app/.venv/bin/pip install --no-cache-dir --quiet \
      --index-url https://download.pytorch.org/whl/cpu \
      torch==2.1.2 torchaudio==2.1.2 \
    && /app/.venv/bin/pip install --no-cache-dir --quiet demucs==4.0.1 \
    && /app/.venv/bin/python -c "from demucs.pretrained import get_model; get_model('htdemucs_6s')"
VOLUME /data
CMD ["node", "--import", "tsx", "services/transcribe/src/worker.ts"]
