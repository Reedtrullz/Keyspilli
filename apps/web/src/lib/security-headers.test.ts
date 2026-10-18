import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("security headers", () => {
  it("configures the global network response policy", async () => {
    if (!nextConfig.headers) throw Error("Global headers are not configured");
    const rules = await nextConfig.headers();
    const all = rules.find((rule) => rule.source === "/:path*");
    if (!all) throw Error("No global response header rule");
    const headers = Object.fromEntries(all.headers.map(({ key, value }) => [key.toLowerCase(), value]));
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("object-src 'none'");
    expect(headers["content-security-policy"]).toContain("base-uri 'self'");
    expect(headers["content-security-policy"]).toContain("form-action 'self'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
