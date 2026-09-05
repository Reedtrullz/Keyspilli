import { afterEach, describe, expect, it } from "vitest";
import { checkMutationAuth } from "./mutation-auth";

const previousToken = process.env.KEYSPILLI_API_TOKEN;

afterEach(() => {
  if (previousToken === undefined) delete process.env.KEYSPILLI_API_TOKEN;
  else process.env.KEYSPILLI_API_TOKEN = previousToken;
});

describe("mutation authentication", () => {
  function request(url: string, headers: Record<string, string> = {}): Request {
    return new Request(url, { method: "POST", headers });
  }

  it("accepts a matching public HTTPS origin behind an internal-port proxy", () => {
    process.env.KEYSPILLI_API_TOKEN = "test-token";
    expect(checkMutationAuth(request("http://internal-web:3000/api/uploads", {
        host: "keys.reidar.tech",
        origin: "https://keys.reidar.tech",
        "sec-fetch-site": "same-origin",
        "x-forwarded-host": "keys.reidar.tech",
        "x-forwarded-proto": "https",
    }))).toBeNull();
  });

  it("preserves an explicit public proxy port and the first forwarded hop", () => {
    process.env.KEYSPILLI_API_TOKEN = "test-token";
    expect(checkMutationAuth(request("http://internal-web:3000/api/uploads", {
      origin: "https://example.test:8443",
      "sec-fetch-site": "same-origin",
      "x-forwarded-host": " example.test:8443, internal-web:3000 ",
      "x-forwarded-proto": " https, http ",
    }))).toBeNull();
  });

  it("accepts direct localhost same-origin requests with their port", () => {
    process.env.KEYSPILLI_API_TOKEN = "test-token";
    expect(checkMutationAuth(request("http://localhost:3000/api/uploads", {
      origin: "http://localhost:3000",
      "sec-fetch-site": "same-origin",
    }))).toBeNull();
  });

  it.each([
    ["cross-origin", "https://evil.example", "cross-site"],
    ["same-site different origin", "https://other.reidar.tech", "same-site"],
    ["direct localhost cross-origin", "http://localhost:3001", "same-origin"],
  ])("rejects %s browser metadata", (_label, origin, fetchSite) => {
    process.env.KEYSPILLI_API_TOKEN = "test-token";
    const response = checkMutationAuth(request("http://localhost:3000/api/uploads", {
      origin,
      "sec-fetch-site": fetchSite,
    }));
    expect(response?.status).toBe(403);
  });

  it.each([
    ["malformed origin", "not-an-origin", "https", "keys.reidar.tech"],
    ["origin path", "https://keys.reidar.tech/path", "https", "keys.reidar.tech"],
    ["malformed forwarded protocol", "https://keys.reidar.tech", "file", "keys.reidar.tech"],
    ["malformed forwarded host", "https://keys.reidar.tech", "https", "keys.reidar.tech/path"],
  ])("fails closed for %s", (_label, origin, protocol, host) => {
    process.env.KEYSPILLI_API_TOKEN = "test-token";
    const response = checkMutationAuth(request("http://internal-web:3000/api/uploads", {
      origin,
      "sec-fetch-site": "same-origin",
      "x-forwarded-host": host,
      "x-forwarded-proto": protocol,
    }));
    expect(response?.status).toBe(403);
  });

  const partialForwardedHeaders: Array<Record<string, string>> = [
    { "x-forwarded-proto": "https" },
    { "x-forwarded-host": "keys.reidar.tech" },
  ];

  it.each(partialForwardedHeaders)("fails closed for partial forwarded metadata", (forwarded) => {
    process.env.KEYSPILLI_API_TOKEN = "test-token";
    const response = checkMutationAuth(request("http://internal-web:3000/api/uploads", {
      origin: "https://keys.reidar.tech",
      "sec-fetch-site": "same-origin",
      ...forwarded,
    }));
    expect(response?.status).toBe(403);
  });

  it("preserves the metadata-only same-origin browser contract", () => {
    process.env.KEYSPILLI_API_TOKEN = "test-token";
    expect(checkMutationAuth(request("http://localhost:3000/api/uploads", {
      "sec-fetch-site": "same-origin",
    }))).toBeNull();
  });

  it("rejects metadata-only browser authorization with malformed proxy headers", () => {
    process.env.KEYSPILLI_API_TOKEN = "test-token";
    const response = checkMutationAuth(request("http://internal-web:3000/api/uploads", {
      "sec-fetch-site": "same-origin",
      "x-forwarded-proto": "https",
    }));
    expect(response?.status).toBe(401);
  });

  it("allows a valid bearer independently of browser origin metadata", () => {
    process.env.KEYSPILLI_API_TOKEN = "test-token";
    expect(checkMutationAuth(request("http://internal-web:3000/api/uploads", {
      authorization: "Bearer test-token",
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    }))).toBeNull();
  });

  it("rejects an invalid bearer that has no browser authorization", () => {
    process.env.KEYSPILLI_API_TOKEN = "test-token";
    const response = checkMutationAuth(request("http://localhost:3000/api/uploads", {
      authorization: "Bearer wrong-token",
    }));
    expect(response?.status).toBe(401);
  });
});
