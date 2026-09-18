import { describe, expect, it } from "vitest";
import { melodyArrangementExecution } from "./melody-arrangement-runtime";

describe("melody arrangement execution", () => {
  it("does not run the producer for Original or disabled paths", () => {
    expect(melodyArrangementExecution(1_891, false, true)).toBe("source");
    expect(melodyArrangementExecution(1_891, true, false)).toBe("source");
  });

  it("uses the worker for large requested arrangements", () => {
    expect(melodyArrangementExecution(256, true, true)).toBe("worker");
  });

  it("keeps only bounded small arrangements synchronous", () => {
    expect(melodyArrangementExecution(255, true, true)).toBe("sync");
  });
});
