import { describe, expect, it, vi } from "vitest";
const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup }));
import { retrieveExternalSource } from "../src/external-retrieval.js";

describe("automatic source network boundary", () => {
  it("rejects a public-looking hostname when any resolved address is private", async () => {
    lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    const result = await retrieveExternalSource({ initialUrl: "https://scores.example/song.mid" }, { allowNetwork: true, retainBytes: true });
    expect(lookup).toHaveBeenCalled();
    expect(result.parserEligible).toBe(false);
    expect(JSON.stringify(result)).toMatch(/private|public address/);
  });
});
