import { resolve } from "node:path";
import {
  buildMusicReview,
  writeMusicReviewPack,
  type MusicReviewInput,
} from "../src/lib/music-review.js";
import { readLocalEvidenceJson } from "../src/lib/local-audio-evidence.js";
const args = process.argv.slice(2);
if (args[0] === "capabilities") {
  console.log(
    JSON.stringify({
      musicReviewContractVersions: [1],
      acousticReceiptVersions: [1],
      playerInputEvidenceVersions:[1],
      providerCalls: 0,
      implicitInference: false,
      humanAttestation: false,
      optionalBackends: [
        "basic-pitch",
        "transkun",
        "hft",
        "moss-hf",
        "moss-native",
        "muscriptor",
        "qwen-modelstudio",
      ],
      antiBridge: "optional",
    }),
  );
} else {
  const manifest = args[args.indexOf("--manifest") + 1],
    output = args[args.indexOf("--output") + 1];
  if (
    !args.includes("--manifest") ||
    !args.includes("--output") ||
    !manifest ||
    !output
  )
    throw new Error("--manifest INPUT.json --output NEW_DIR required");
  const value = (await readLocalEvidenceJson(
    resolve(manifest),
  )) as MusicReviewInput;
  const report = buildMusicReview(value);
  await writeMusicReviewPack(report, resolve(output));
  console.log(
    JSON.stringify({
      output: resolve(output),
      inputSha256: report.inputSha256,
      providerCalls: 0,
      musicalAcceptance: report.musicalAcceptance,
    }),
  );
}
