import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
  serverExternalPackages: ["better-sqlite3"],
  webpack(config) {
    // Workspace TS packages use ESM-style ".js" import specifiers.
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};

export default nextConfig;
