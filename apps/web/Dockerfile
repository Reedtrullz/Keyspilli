FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/catalog/package.json packages/catalog/package.json
COPY packages/engrave/package.json packages/engrave/package.json
COPY packages/midi/package.json packages/midi/package.json
COPY packages/player-core/package.json packages/player-core/package.json
COPY services/transcribe/package.json services/transcribe/package.json
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
ENV npm_config_python=/usr/bin/python3
RUN npm ci --no-audit --no-fund
COPY packages packages
COPY services services
COPY catalog/manifest.json catalog/manifest.json
COPY catalog/learner-review.json catalog/learner-review.json
COPY catalog/chord-sources.json catalog/chord-sources.json
COPY catalog/song-sections.json catalog/song-sections.json
COPY catalog/chord-timelines catalog/chord-timelines
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1
ARG VERSION=dev
ENV VERSION=$VERSION
RUN npm run build -w @keyspilli/web

# Browser dependencies do not inherit changing application files or VERSION.
FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS browser-assets
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY apps/web/scripts/verify-playwright-runtime.mjs apps/web/scripts/verify-playwright-runtime.mjs
ARG BUILDPLATFORM
ARG TARGETPLATFORM
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# Install the browser from the exact Playwright package resolved by package-lock.json.
RUN npx --no-install playwright install chromium
# Launch it in an environment matching the final runtime image. This catches missing
# browser libraries during image construction instead of on the first PDF request.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
RUN if [ "$BUILDPLATFORM" = "$TARGETPLATFORM" ]; then \
      node apps/web/scripts/verify-playwright-runtime.mjs; \
    else \
      echo "Skipping Chromium launch under cross-architecture emulation"; \
    fi

FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV KEYSPILLI_DATA_DIR=/data
ENV KEYSPILLI_ORIGIN=http://127.0.0.1:3000
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# Chromium for PDF export
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
COPY --from=browser-assets /ms-playwright /ms-playwright
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/catalog/learner-review.json ./catalog/learner-review.json
COPY --from=build /app/catalog/manifest.json ./catalog/manifest.json
COPY --from=build /app/catalog/chord-sources.json ./catalog/chord-sources.json
COPY --from=build /app/catalog/chord-timelines ./catalog/chord-timelines
RUN mkdir -p /data/uploads && chown -R 1000:1000 /data
VOLUME /data
EXPOSE 3000
ARG VERSION=dev
ENV VERSION=$VERSION
CMD ["node", "apps/web/server.js"]
