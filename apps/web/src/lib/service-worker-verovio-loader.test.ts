import { expect, it } from "vitest";
import { evaluateVerovioModuleSource, loadServiceWorkerVerovio } from "../../public/verovio/service-worker-verovio-loader.mjs";

it("evaluates the browser engine with its module URL bound for ServiceWorker scope", async () => {
  const source = 'function createVerovioModule(){ return { url: import.meta.url }; }\nexport default createVerovioModule;\n';
  const factory = evaluateVerovioModuleSource(source, "http://example.test/verovio/verovio-module.mjs") as () => Promise<{url:string}>;
  await expect(Promise.resolve(factory())).resolves.toEqual({ url: "http://example.test/verovio/verovio-module.mjs" });
});

it("rejects a source without the pinned default export", () => {
  expect(() => evaluateVerovioModuleSource("const value = 1;", "http://example.test/verovio-module.mjs")).toThrow(/default export/);
});

it("fetches the cached engine and constructs the toolkit", async () => {
  const source = 'function createVerovioModule(){ return { url: import.meta.url }; }\nexport default createVerovioModule;\n';
  const fetchImpl = async () => ({ ok: true, text: async () => source });
  class Toolkit { constructor(readonly module: {url:string}) {} }
  const toolkit = await loadServiceWorkerVerovio(fetchImpl, Toolkit, "http://example.test/verovio-module.mjs");
  expect(toolkit.module).toEqual({ url: "http://example.test/verovio-module.mjs" });
});
