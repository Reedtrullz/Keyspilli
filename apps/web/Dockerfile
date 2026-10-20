FROM node:22-slim AS build
ARG VERSION=dev
WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages packages
COPY services services
COPY catalog/manifest.json catalog/manifest.json
COPY catalog/learner-review.json catalog/learner-review.json
COPY catalog/chord-sources.json catalog/chord-sources.json
COPY catalog/chord-timelines catalog/chord-timelines
RUN npm ci --no-audit --no-fund
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1
ENV VERSION=$VERSION
RUN npm run build -w @keyspilli/web

FROM build AS browser-assets
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

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV KEYSPILLI_DATA_DIR=/data
ENV KEYSPILLI_ORIGIN=http://127.0.0.1:3000
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ARG VERSION=dev
ENV VERSION=$VERSION
# Chromium for PDF export
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node --from=browser-assets /ms-playwright /ms-playwright
COPY --chown=node:node --from=build /app/apps/web/.next/standalone ./
COPY --chown=node:node --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --chown=node:node --from=build /app/apps/web/public ./apps/web/public
COPY --chown=node:node --from=build /app/catalog/learner-review.json ./catalog/learner-review.json
COPY --chown=node:node --from=build /app/catalog/manifest.json ./catalog/manifest.json
COPY --chown=node:node --from=build /app/catalog/chord-sources.json ./catalog/chord-sources.json
COPY --chown=node:node --from=build /app/catalog/chord-timelines ./catalog/chord-timelines
# Run unprivileged; a fresh /data volume inherits this ownership.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
