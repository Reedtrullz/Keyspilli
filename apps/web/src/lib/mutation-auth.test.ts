import { afterEach, describe, expect, it, vi } from "vitest";
import { checkMutationAuth } from "./mutation-auth";

const originalToken = process.env.KEYSPILLI_API_TOKEN;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalToken === undefined) delete process.env.KEYSPILLI_API_TOKEN;
  else process.env.KEYSPILLI_API_TOKEN = originalToken;
});

describe("checkMutationAuth", () => {
  it("fails closed when the server token is absent", async () => {
    delete process.env.KEYSPILLI_API_TOKEN;
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = checkMutationAuth(new Request("https://keys.example/api/youtube", {
      method: "POST",
    }));

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({
      error: "server authentication is not configured",
    });
  });

  it.each([undefined, "Basic secret", "Bearer wrong-secret"])(
    "rejects a missing or invalid Authorization header (%s)",
    async (authorization) => {
      process.env.KEYSPILLI_API_TOKEN = "correct-secret";
      const headers = authorization ? { authorization } : undefined;
      const response = checkMutationAuth(new Request("https://keys.example/api/youtube", {
        method: "POST",
        headers,
      }));

      expect(response?.status).toBe(401);
      await expect(response?.json()).resolves.toEqual({ error: "unauthorized" });
    },
  );

  it("accepts the exact bearer token", () => {
    process.env.KEYSPILLI_API_TOKEN = "correct-secret";
    const response = checkMutationAuth(new Request("https://keys.example/api/youtube", {
      method: "POST",
      headers: { authorization: "Bearer correct-secret" },
    }));

    expect(response).toBeNull();
  });
});
