#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import { validateScoreReviewInput, loadSymbolicReviewInput, scoreReviewCodeIdentity, readBoundedScoreFile } from "../src/lib/symbolic-review-input.js";
import { buildSymbolicReviewReceipt } from "../src/lib/symbolic-review.js";
import { buildScoreReviewReport, writeScoreReviewReport, joinSavedAudioObservation, type SavedAudioObservation } from "../src/lib/score-review.js";
const run = promisify(execFile);
export const SCORE_REVIEW_CAPABILITIES = { schemaVersion: 1, inputSchemaVersion: 1, reportSchemaVersion: 1, symbolicReceiptSchemaVersion: 1, offline: true, offlineProviderCalls: 0, defaultMode: "offline", nativeFormats: ["midi", "musicxml", "mxl"], boundAudio: true, evidenceProfile: "evidence-v2", maxRequests: 1, automaticStructuralPlayability: true, locatedFindings: true, repairPreviews: true, requiresOwnerListening: false, productionAdmission: false };
async function main(): Promise<number> {
    const argv = process.argv.slice(2);
    if (argv.length === 1 && argv[0] === "capabilities") {
        console.log(JSON.stringify(SCORE_REVIEW_CAPABILITIES));
        return 0;
    }
    const positional: string[] = [], values = new Map<string, string>(), flags = new Set<string>();
    const valueNames = ["--anti-result", "--max-requests", "--anti-python", "--anti-script", "--base-url", "--model", "--account-binding-json"];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (!arg.startsWith("--"))
            positional.push(arg);
        else if (["--offline", "--send-audio"].includes(arg)) {
            if (flags.has(arg))
                throw new Error("duplicate flag");
            flags.add(arg);
        }
        else {
            if (!valueNames.includes(arg) || values.has(arg))
                throw new Error(`unknown or repeated option ${arg}`);
            const value = argv[++i];
            if (!value || value.startsWith("--"))
                throw new Error(`${arg} requires a value`);
            values.set(arg, value);
        }
    }
    if (positional.length !== 2)
        throw new Error("Usage: review-score.mts INPUT.json NEW_OUTPUT [--offline [--anti-result REPORT.json] | --send-audio --max-requests 1 --anti-python PATH --anti-script PATH --base-url URL --model MODEL --account-binding-json PATH]");
    const send = flags.has("--send-audio");
    if (send && (flags.has("--offline") || values.has("--anti-result")))
        throw new Error("offline/saved-result and send-audio modes are exclusive");
    if (!send && valueNames.slice(1).some(key => values.has(key)))
        throw new Error("upload options require --send-audio");
    const inputBytes = await readBoundedScoreFile(resolve(positional[0]!));
    const input = await loadSymbolicReviewInput(validateScoreReviewInput(JSON.parse(inputBytes.toString("utf8"))));
    if (send) {
        if (values.get("--max-requests") !== "1" || input.manifest.jobs.length !== 1)
            throw new Error("live review requires one job and --max-requests 1");
        for (const key of valueNames.slice(2))
            if (!values.has(key))
                throw new Error(`${key} required for bounded live review`);
    }
    const symbolic = buildSymbolicReviewReceipt(input, await scoreReviewCodeIdentity());
    let audio: SavedAudioObservation | undefined;
    if (values.has("--anti-result"))
        audio = await joinSavedAudioObservation(input, resolve(values.get("--anti-result")!));
    const out = resolve(positional[1]!);
    await writeScoreReviewReport(buildScoreReviewReport({ input, symbolic, audio }), out);
    let exitCode = 0;
    if (send) {
        const audioOut = join(out, "audio");
        const args = ["--import", "tsx", new URL("review-song-audio.mts", import.meta.url).pathname, input.input.manifest.path, audioOut, "--send-audio", "--review-profile", "evidence-v2", "--max-requests", "1", ...valueNames.slice(2).flatMap(key => [key, values.get(key)!])];
        try {
            await run(process.execPath, args, { timeout: 100000, maxBuffer: 2 * 1024 * 1024 });
            audio = await joinSavedAudioObservation(input, join(audioOut, "report.json"));
        }
        catch (error) {
            let attempts = 0;
            try {
                attempts = JSON.parse(await readFile(join(audioOut, "state.json"), "utf8")).attemptsUsed;
            }
            catch { /* Pre-dispatch failures have no reserved attempt. */ }
            audio = { status: attempts ? "failed" : "blocked", reportSha256: null, attemptsReserved: attempts, validatedResponses: 0, comparedJobs: 0, findings: [], reason: attempts ? "Bound provider attempt did not produce an admitted response; immutable raw evidence retained; no retry" : "Audio prerequisite failed before reservation; inspect retained audio diagnostics" };
            exitCode = attempts ? 3 : 2;
        }
        await writeScoreReviewReport(buildScoreReviewReport({ input, symbolic, audio }), out, true);
    }
    console.log(JSON.stringify({ status: "diagnosis-complete", report: join(out, "index.html"), reportJson: join(out, "report.json"), audio: audio?.status ?? "not-run", exitCode, productionAdmission: false }));
    return exitCode;
}
try {
    process.exitCode = await main();
}
catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
}
