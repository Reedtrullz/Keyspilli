import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ImportProgress, { stagePercent } from "./ImportProgress";

function render(status: string, stage = "", furthest = 0, elapsedSeconds = 120, cancelled = false) {
  return renderToStaticMarkup(<ImportProgress {...{status,stage,furthest,elapsedSeconds,cancelled}} />);
}

describe("import progress", () => {
  it("keeps waiting and unknown stages indeterminate", () => {
    expect(render("queued")).toContain("Waiting for your turn");
    expect(render("queued")).not.toContain("aria-valuenow");
    expect(render("processing", "unknown", 85)).not.toContain("aria-valuenow");
  });
  it("uses stage estimates, never time-based completion", () => {
    expect(stagePercent("extracting")).toBeLessThan(100);
    expect(render("processing", "extracting", 0, 3600)).toContain('aria-valuenow="50"');
    expect(render("processing", "publishing", 100)).toContain('aria-valuenow="95"');
  });
  it("explains alternative sources while retaining estimated progress", () => {
    const html = render("processing", "downloading", 85);
    expect(html).toContain('aria-valuenow="85"');
    expect(html).toContain("Checking another tutorial");
    expect(html).toContain("Getting the tutorial");
  });
  it("reserves completion for success and removes the bar on failure or cancellation", () => {
    expect(render("done")).toContain('aria-valuenow="100"');
    expect(render("done")).toContain("Your piano lesson is ready");
    expect(render("error", "publishing", 95)).not.toContain('role="progressbar"');
    expect(render("error", "", 0, 0, true)).toContain("Preview cancelled");
  });
});
