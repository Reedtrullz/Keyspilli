import { beforeEach, describe, expect, it, vi } from "vitest";

const countSongs = vi.hoisted(() => vi.fn());
const hasSourceCandidateProvider = vi.hoisted(() => vi.fn());

vi.mock("@keyspilli/catalog", () => ({ countSongs }));
vi.mock("../../../lib/source-candidate-provider", () => ({ hasSourceCandidateProvider }));

import { GET } from "./route";

describe("health route capabilities", () => {
  beforeEach(() => {
    countSongs.mockReturnValue(12);
    hasSourceCandidateProvider.mockReturnValue(true);
  });

  it("reports non-secret product capabilities without probing the provider", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      capabilities: {
        symbolicUpload: true,
        sourceDiscoveryConfigured: true,
        directAudioAmt: false,
      },
    });
    expect(hasSourceCandidateProvider).toHaveBeenCalledOnce();
  });
});
