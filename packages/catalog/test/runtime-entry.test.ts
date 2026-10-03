import { expect, it } from "vitest";
import * as runtime from "../src/runtime.js";
it("exposes catalog reads separately from media workers and research evaluators", () => {
  expect(runtime.listSongsGroupedWithTotal).toBeTypeOf("function");
  expect(runtime.inspectCatalogReadiness).toBeTypeOf("function");
  expect(runtime).not.toHaveProperty("filterTranscription");
  expect(runtime).not.toHaveProperty("evaluateShadowCorpus");
  expect(runtime).not.toHaveProperty("renderMidiToWav");
});
