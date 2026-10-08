import { expect, it } from "vitest";
import { readFile, symlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { scoreFixture } from "./score-review-test-fixture.js";
import { loadSymbolicReviewInput, validateScoreReviewInput } from "./symbolic-review-input.js";
import { buildSymbolicReviewReceipt } from "./symbolic-review.js";
import { buildScoreReviewReport, writeScoreReviewReport, joinSavedAudioObservation } from "./score-review.js";
import { stableJson, sha256Text } from "./audio-review.js";
import { buildScoreReviewRepairActions } from "./score-review-repair.js";
it("joins only matching retained bound responses and keeps provider advice noneditable", async () => {
    const f = await scoreFixture();
    try {
        const n = await loadSymbolicReviewInput(validateScoreReviewInput(f.input));
        await mkdir(join(f.root, "saved"));
        await mkdir(join(f.root, "saved/evidence"));
        await mkdir(join(f.root, "saved/evidence/responses"));
        const schema = stableJson(JSON.parse(await readFile(new URL("../../schemas/audio-review-evidence-v2.json", import.meta.url), "utf8")));
        await f.pin("saved/response-schema.json", schema);
        const binding = { configSha256: "a".repeat(64), gatewayInstance: "b".repeat(32) };
        const raw = { schemaVersion: 1, runStatus: "success", mode: "listen", model: "gemini-3.1-pro", metadata: { result_quality: "complete", account_binding_config_sha256: binding.configSha256, account_binding_gateway_instance: binding.gatewayInstance, account_binding_verified_before_attempt: true, media_coverage: { kind: "audio", captured_count: 2, gateway_attempts: 1, status: "attempted", provider_audio_acceptance: "unverified", listening_verification: "not_run", audio: [{ index: 1, sha256: n.manifest.jobs[0]!.referenceClip.sha256, bytes: 44 }, { index: 2, sha256: n.manifest.jobs[0]!.candidateClip.sha256, bytes: 44 }] } }, output_text: JSON.stringify({ schemaVersion: 2, comparisonStatus: "abstained", attachments: { reference: { content: "uncertain", evidence: "Mock contract fixture" }, candidate: { content: "uncertain", evidence: "Mock contract fixture" } }, summary: "Abstained", uncertainty: "high", limitations: ["Unit fixture is not live listening evidence"], findings: [] }) };
        const response = await f.pin("saved/evidence/responses/control-original.json", raw);
        const report = { schemaVersion: 2, kind: "keyspilli-audio-review-report", musicalAcceptance: "not-established", coverage: { calibrated: false }, manifestSha256: sha256Text(stableJson(n.manifest)), reviewProfile: "evidence-v2", reviewSchemaVersion: 2, responseSchemaSha256: sha256Text(schema), submissionEvidence: { attemptsReserved: 1 }, accountBinding: binding, provider: { requestedModel: "gemini-3.1-pro" }, jobs: [{ id: "control-original", mode: "original", phraseId: "phrase", status: "complete", media: { reference: n.manifest.jobs[0]!.referenceClip, candidate: n.manifest.jobs[0]!.candidateClip }, submission: { responseSha256: response.sha256, resolvedModel: "gemini-3.1-pro", allowedModelIds: ["gemini-3.1-pro"] } }] };
        const saved = await f.pin("saved/report.json", report);
        const audio = await joinSavedAudioObservation(n, saved.path);
        expect(audio.validatedResponses).toBe(1);
        expect(audio.comparedJobs).toBe(0);
        const result = buildScoreReviewReport({ input: n, symbolic: buildSymbolicReviewReceipt(n), audio: { ...audio, findings: [{ mode: "original", phraseId: "phrase", startSeconds: 0, reason: "Provider-only chord suggestion" }] } });
        expect(buildScoreReviewRepairActions(result).find(a => a.reason.includes("Provider-only"))?.kind).toBe("advisory-only");
        for (const change of [{ manifestSha256: "0".repeat(64) }, { responseSchemaSha256: "0".repeat(64) }, { reviewProfile: "legacy" }]) {
            await f.pin("saved/report.json", { ...report, ...change });
            await expect(joinSavedAudioObservation(n, saved.path)).rejects.toThrow();
        }
        await f.pin("saved/report.json", report);
        await f.pin("saved/evidence/responses/control-original.json", { ...raw, runStatus: "failed" });
        await expect(joinSavedAudioObservation(n, saved.path)).rejects.toThrow(/hash/);
    }
    finally {
        await f.cleanup();
    }
});
it("escapes text, ignores legacy claimed passes and refuses overwrite", async () => {
    const f = await scoreFixture();
    try {
        const n = await loadSymbolicReviewInput(validateScoreReviewInput(f.input));
        n.manifest.reference.identity.title = '<script>alert("bad")</script>';
        const s = buildSymbolicReviewReceipt(n, { sha256: "a".repeat(64), inventory: [] });
        const r = buildScoreReviewReport({ input: n, symbolic: s });
        const out = join(f.root, "report");
        await writeScoreReviewReport(r, out);
        const html = await readFile(join(out, "index.html"), "utf8");
        expect(html).not.toContain('<script>alert');
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('<textarea');
        expect(html).toContain('<strong>Literal Conformance</strong>');
        expect(html).toContain('<strong>Source Fidelity</strong>');
        expect(r.productionAdmission).toBe(false);
        await expect(writeScoreReviewReport(r, out)).rejects.toThrow();
    }
    finally {
        await f.cleanup();
    }
});
it("rejects stale symbolic receipts", async () => {
    const f = await scoreFixture();
    try {
        const n = await loadSymbolicReviewInput(validateScoreReviewInput(f.input));
        const s = buildSymbolicReviewReceipt(n);
        s.inputSha256 = "0".repeat(64);
        expect(() => buildScoreReviewReport({ input: n, symbolic: s })).toThrow(/stale/);
    }
    finally {
        await f.cleanup();
    }
});
it("does not update a symlinked report even with a copied ownership marker", async () => {
    const f = await scoreFixture();
    try {
        const n = await loadSymbolicReviewInput(validateScoreReviewInput(f.input));
        const report = buildScoreReviewReport({ input: n, symbolic: buildSymbolicReviewReceipt(n, { sha256: "a".repeat(64), inventory: [] }) });
        const out = join(f.root, "report");
        await writeScoreReviewReport(report, out);
        await symlink(out, join(f.root, "linked"));
        await expect(writeScoreReviewReport(report, join(f.root, "linked"), true)).rejects.toThrow(/symlink/);
    }
    finally {
        await f.cleanup();
    }
});
