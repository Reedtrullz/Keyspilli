import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("wires service-worker messages to the shared render dispatcher", () => {
  const source = readFileSync(join(process.cwd(), "public/verovio/render-service-worker.mjs"), "utf8");
  expect(source).toContain('import createVerovioModule from "/verovio/verovio-module.mjs"');
  expect(source).toContain('import { VerovioToolkit } from "/verovio/verovio.mjs"');
  expect(source).toContain('import "/verovio/render-worker.mjs"');
  expect(source).toContain("__keyspilliVerovioFactory");
  expect(source).toContain('self.addEventListener("install", () => self.skipWaiting())');
  expect(source).toContain('self.addEventListener("activate", event => event.waitUntil(self.clients.claim()))');
  expect(source).toContain('self.addEventListener("message"');
  expect(source).toContain("event.ports[0]");
  expect(source).toContain("event.waitUntil");
  expect(source).toContain("__keyspilliVerovioDispatch");
});
