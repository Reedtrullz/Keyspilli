import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { readLocalEvidenceJson } from "../src/lib/local-audio-evidence.js";
import {
  previewMusicRepair,
  type RepairProposal,
} from "../src/lib/music-repair-preview.js";
import type { ReplaySnapshot } from "../src/lib/music-correspondence.js";
const args = process.argv.slice(2),
  arg = (name: string) =>
    args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const input = arg("--snapshot"),
  proposal = arg("--proposal"),
  output = arg("--output");
if (!input || !proposal || !output)
  throw new Error(
    "--snapshot PINNED.json --proposal PROPOSAL.json --output NEW_DIR required",
  );
const snapshot = (await readLocalEvidenceJson(
  resolve(input),
)) as ReplaySnapshot;
const request = (await readLocalEvidenceJson(
  resolve(proposal),
)) as RepairProposal;
const preview = previewMusicRepair(snapshot, request);
const dest = resolve(output);
await mkdir(dest, { recursive: false });
await writeFile(join(dest, "preview.json"), JSON.stringify(preview, null, 2), {
  flag: "wx",
});
await writeFile(
  join(dest, "candidate.snapshot.json"),
  JSON.stringify(preview.snapshot, null, 2),
  { flag: "wx" },
);
await writeFile(
  join(dest, "recheck-required.json"),
  JSON.stringify(
    {
      status: "pending",
      checks: preview.requiredRechecks,
      previousObservationsMayApproveChangedAudio: false,
    },
    null,
    2,
  ),
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    output: dest,
    originalSha256: preview.originalSha256,
    candidateSha256: preview.snapshot.sourceSha256,
    catalogMutations: 0,
    musicalAcceptance: "not-established",
  }),
);
