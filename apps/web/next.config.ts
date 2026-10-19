import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

/**
 * Baseline security headers for every response (pages, API routes, assets).
 *
 * The CSP deliberately restricts framing, plugins, <base> and form targets
 * only. A script-src policy is not enforced yet: Next.js App Router emits
 * inline RSC bootstrap scripts that need a per-request nonce (middleware +
 * dynamic rendering), and the Verovio worker needs 'wasm-unsafe-eval'. A
 * hash-only script-src would block those scripts, and a hash next to
 * 'unsafe-inline' disables 'unsafe-inline' in CSP2+ browsers.
 * HSTS is set at the TLS edge (deploy/templates/keyspilli-caddy-block.j2).
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: ["frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'", "form-action 'self'"].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // /verovio/* is served unhashed from public/, so Next's default is
      // max-age=0 and every visit revalidates the 7.6 MB WASM module. The
      // module only changes with a Verovio upgrade; the small worker and
      // wrapper stay on a short window so code changes reach users quickly.
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
