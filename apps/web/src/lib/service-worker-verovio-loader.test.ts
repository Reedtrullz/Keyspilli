import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { evaluateVerovioModuleSource, loadServiceWorkerVerovio, VEROVIO_MODULE_SHA256 } from "../../public/verovio/service-worker-verovio-loader.mjs";

it("evaluates the browser engine with its module URL bound for ServiceWorker scope", async () => {
  const source = 'function createVerovioModule(){ return { url: import.meta.url }; }\nexport default createVerovioModule;\n';
  const factory = evaluateVerovioModuleSource(source, "http://example.test/verovio/verovio-module.mjs") as () => Promise<{url:string}>;
  await expect(Promise.resolve(factory())).resolves.toEqual({ url: "http://example.test/verovio/verovio-module.mjs" });
});

it("rejects a source without the pinned default export", () => {
  expect(() => evaluateVerovioModuleSource("const value = 1;", "http://example.test/verovio-module.mjs")).toThrow(/default export/);
});

it("fetches the cached engine, verifies its bytes and constructs the toolkit", async () => {
  const source = 'function createVerovioModule(){ return { url: import.meta.url }; }\nexport default createVerovioModule;\n';
  const moduleUrl = "http://example.test/verovio-module.mjs";
  const fetchImpl = async () => ({ ok: true, status: 200, redirected: false, url: moduleUrl, text: async () => source });
  class Toolkit { constructor(readonly module: {url:string}) {} }
  const digest = createHash("sha256").update(source).digest("hex");
  const toolkit = await loadServiceWorkerVerovio(fetchImpl, Toolkit, moduleUrl, digest);
  expect(toolkit.module).toEqual({ url: moduleUrl });
});

it("pins the shipped engine and rejects altered or redirected code", async () => {
  const shipped = readFileSync(new URL("../../public/verovio/verovio-module.mjs", import.meta.url));
  expect(createHash("sha256").update(shipped).digest("hex")).toBe(VEROVIO_MODULE_SHA256);
  const moduleUrl = "http://example.test/verovio/verovio-module.mjs";
  const response = { ok: true, status: 200, redirected: false, url: moduleUrl, text: async () => "export default createVerovioModule;\n" };
  class Toolkit {}
  await expect(loadServiceWorkerVerovio(async () => response, Toolkit, moduleUrl)).rejects.toThrow(/integrity/);
  await expect(loadServiceWorkerVerovio(async () => ({ ...response, url: "http://example.test/other.mjs" }), Toolkit, moduleUrl)).rejects.toThrow(/unavailable/);
});
