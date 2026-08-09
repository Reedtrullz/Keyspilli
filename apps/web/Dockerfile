FROM node:22-slim AS build
ARG VERSION=dev
WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages packages
COPY services services
RUN npm ci --no-audit --no-fund
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1
ENV VERSION=$VERSION
RUN npm run build -w @keyspilli/web

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV KEYSPILLI_DATA_DIR=/data
ENV KEYSPILLI_ORIGIN=http://127.0.0.1:3000
ARG VERSION=dev
ENV VERSION=$VERSION
# Chromium for PDF export
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
RUN npx --yes playwright@1.51.1 install chromium --with-deps || true
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
VOLUME /data
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
