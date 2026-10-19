import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  // Catalog artifacts, source MIDI, uploads, and the SQLite database are
  // mutable runtime state mounted at /data in production. Keep the checked-in
  // catalog metadata under /catalog available to the image (the Dockerfile
  // copies those files explicitly) while preventing a local checkout's large
  // data volume from being baked into the standalone bundle.
  outputFileTracingExcludes: {
    "/*": ["../../data/**"],
  },
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    // /verovio/* is served unhashed from public/, so Next's default is
    // max-age=0 and every visit revalidates the 7.6 MB WASM module. The module
    // only changes with a Verovio upgrade; the small worker and wrapper stay
    // on a short window so code changes reach users quickly.
    return [
      {
        source: "/verovio/verovio-module.mjs",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" }],
      },
      {
        source: "/verovio/:file(render-worker.mjs|verovio.mjs)",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" }],
      },
    ];
  },
  turbopack: {},
  webpack(config) {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};

export default nextConfig;
