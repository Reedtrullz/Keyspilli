import { expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: (handler: unknown) => handler }));
vi.mock("@/lib/api-auth", () => ({ verifyBearer: () => false }));
vi.mock("@/lib/authz", () => ({ accessRole: () => "anonymous", gateDecision: () => "home" }));

it("keeps Verovio static assets and its service worker outside the app session gate", async () => {
  const { config } = await import("./proxy");
  const matcher = new RegExp(`^${config.matcher[0]}$`);
  expect(matcher.test("/verovio/render-service-worker.mjs")).toBe(false);
  expect(matcher.test("/verovio/render-worker.mjs")).toBe(false);
  expect(matcher.test("/verovio/verovio-module.mjs")).toBe(false);
  expect(matcher.test("/verovio/COPYING")).toBe(false);
  expect(matcher.test("/verovio/nested/private.mjs")).toBe(true);
  expect(matcher.test("/player/song/sheet")).toBe(true);
});
