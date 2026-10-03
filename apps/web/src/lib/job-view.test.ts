import { expect, it, vi } from "vitest";
const getArtifactFile = vi.hoisted(() => vi.fn());
vi.mock("./catalog-api", () => ({ getArtifactFile }));
import { publicJobView } from "./job-view";
it("distinguishes completed, missing, cancelled and reconciliation jobs without raw errors", async () => {
  getArtifactFile.mockResolvedValueOnce(Buffer.from("validated"));
  expect(await publicJobView({ status: "done", songId: "song-e", error: null })).toMatchObject({ displayState: "Completed", resultAvailable: true });
  getArtifactFile.mockResolvedValue(null);
  expect(await publicJobView({ status: "done", songId: "deleted-e", error: null })).toMatchObject({ displayState: "Result unavailable", resultAvailable: false });
  expect(await publicJobView({ status: "error", error: "attempt 1: ARTIFACT_RECONCILIATION_REQUIRED: /private/token" })).toMatchObject({ displayState: "Needs reconciliation", resultAvailable: false });
  expect(await publicJobView({ status: "error", error: "TUTORIAL_PREVIEW_CANCELLED" })).toMatchObject({ displayState: "Cancelled" });
  expect((await publicJobView({ status: "error", error: "credential-secret" })).error).not.toContain("credential-secret");
});

it("shows resource capacity separately without private subprocess details",async()=>{
 const result=await publicJobView({status:"error",error:"attempt 1: RESOURCE_BLOCKED: /private/token"});
 expect(result).toMatchObject({displayState:"Resource blocked",resultAvailable:false});expect(result.error).toContain("Review capacity");expect(result.error).not.toContain("/private");
});
