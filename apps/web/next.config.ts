import type { NextConfig } from "next";

const monorepoRoot = new URL("../..", import.meta.url).pathname;

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {},
  webpack(config) {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};

export default nextConfig;
