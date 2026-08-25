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
  turbopack: {},
  webpack(config) {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};

export default nextConfig;
