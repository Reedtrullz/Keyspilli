import { afterEach, describe, expect, it, vi } from "vitest";
import { checkTokenAuth, hasValidBearer } from "./api-auth";

const req = (headers: Record<string, string>) => new Request("http://x/api", { method: "POST", headers });

afterEach(() => vi.unstubAllEnvs());

describe("bearer checks", () => {
  it("accepts the exact bearer via Authorization or the transport header", () => {
    expect(hasValidBearer(req({ authorization: "Bearer s3cret" }), "s3cret")).toBe(true);
    expect(hasValidBearer(req({ "x-keyspilli-api-token": "Bearer s3cret" }), "s3cret")).toBe(true);
  });

  it("rejects wrong, shorter, longer and missing values without throwing", () => {
    for (const value of ["Bearer s3cre", "Bearer s3cretX", "Bearer wrong!", ""]) {
      expect(hasValidBearer(req(value ? { authorization: value } : {}), "s3cret")).toBe(false);
    }
  });

  it("returns 503 when no token is configured and 401 on mismatch", async () => {
    vi.stubEnv("KEYSPILLI_API_TOKEN", "");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(checkTokenAuth(req({ authorization: "Bearer s3cret" }))?.status).toBe(503);
    vi.stubEnv("KEYSPILLI_API_TOKEN", "s3cret");
    expect(checkTokenAuth(req({ authorization: "Bearer nope" }))?.status).toBe(401);
    expect(checkTokenAuth(req({ authorization: "Bearer s3cret" }))).toBeNull();
  });
});
