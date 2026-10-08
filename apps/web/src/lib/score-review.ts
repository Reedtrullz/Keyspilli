import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, lstat } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { assertMusic } from "@keyspilli/catalog/src/acoustic-receipt.js";
import { validateAudioReport, validateListenEnvelope, parseAntiLiveStdout, sha256Text, stableJson, type ReviewMode } from "./audio-review.js";
import { readScorePin, readScoreJson, readBoundedScoreFile, type NormalizedScoreReviewInput, type NormalizedScoreEvent } from "./symbolic-review-input.js";
import type { SymbolicReviewReceiptV1, ScoreFinding } from "./symbolic-review.js";
import { buildScoreReviewRepairActions } from "./score-review-repair.js";
export interface SavedAudioObservation {
    status: "validated" | "failed" | "blocked";
    reportSha256: string | null;
    attemptsReserved: number;
    validatedResponses: number;
    comparedJobs: number;
    findings: Array<{
        mode: ReviewMode;
        phraseId: string;
        startSeconds: number;
        reason: string;
    }>;
    reason: string;
}
export interface ScoreReviewReportInput {
    input: NormalizedScoreReviewInput;
    symbolic: SymbolicReviewReceiptV1;
    audio?: SavedAudioObservation;
}
export interface ScoreReviewReportV1 {
    schemaVersion: 1;
    kind: "keyspilli-score-review-report";
    status: "diagnosis-complete";
    title: string;
    inputSha256: string;
    manifestSha256: string;
    input: NormalizedScoreReviewInput["input"];
    symbolic: SymbolicReviewReceiptV1;
    sourceAuthority: NormalizedScoreReviewInput["source"]["authority"];
    sourceRelationship: NormalizedScoreReviewInput["source"]["relationship"];
    lanes: {
        symbolic: {
            status: "complete";
        };
        audio: SavedAudioObservation | {
            status: "not-run";
            reason: string;
        };
        realization: {
            status: "not-established";
            reason: string;
        };
    };
    findings: ScoreFinding[];
    legacyDeclarations: unknown;
    limitations: string[];
    inventories: Partial<Record<ReviewMode, {
        expected: NormalizedScoreEvent[];
        replayed: NormalizedScoreEvent[];
    }>>;
    providerListeningAttestation: "unverified";
    listeningAttestation: "unverified";
    listeningCalibration: "unqualified";
    musicalAcceptance: "not-established";
    productionAdmission: false;
    catalogMutations: 0;
}
export function buildScoreReviewReport({ input, symbolic, audio }: ScoreReviewReportInput): ScoreReviewReportV1 {
    assertMusic(symbolic.inputSha256 === input.inputSha256 && symbolic.manifestSha256 === input.manifestSha256, "stale symbolic receipt");
    return { schemaVersion: 1, kind: "keyspilli-score-review-report", status: "diagnosis-complete", title: input.manifest.reference.identity.title, inputSha256: input.inputSha256, manifestSha256: input.manifestSha256, input: input.input, symbolic, sourceAuthority: input.source.authority, sourceRelationship: input.source.relationship, lanes: { symbolic: { status: "complete" }, audio: audio ?? { status: "not-run", reason: "Offline review; no provider request" }, realization: { status: "not-established", reason: "Resolved scheduling or MIDI equality does not establish audible realization" } }, findings: symbolic.findings, inventories: Object.fromEntries(Object.entries(input.modes).map(([m, r]) => [m, { expected: r.expected, replayed: r.replayed }])), legacyDeclarations: Object.fromEntries(Object.entries(input.manifest.replays).map(([mode, replay]) => [mode, { declaration: replay.symbolicChecks, admitted: false, reason: "Legacy manifest declarations are not the newly computed checker receipts" }])), limitations: [...symbolic.limitations, "Expert fingering and musical judgments are evidence limits, not owner review tasks."], providerListeningAttestation: "unverified", listeningAttestation: "unverified", listeningCalibration: "unqualified", musicalAcceptance: "not-established", productionAdmission: false, catalogMutations: 0 };
}
export async function joinSavedAudioObservation(input: NormalizedScoreReviewInput, path: string): Promise<SavedAudioObservation> {
    const bytes = await readBoundedScoreFile(path);
    const report = JSON.parse(bytes.toString("utf8"));
    validateAudioReport(report);
    assertMusic(report.manifestSha256 === sha256Text(stableJson(input.manifest)) && report.reviewProfile === "evidence-v2" && report.reviewSchemaVersion === 2, "saved audio observation differs from selected manifest/profile");
    assertMusic(Array.isArray(report.jobs) && report.jobs.length === input.manifest.jobs.length, "saved audio jobs differ");
    assertMusic(Number.isInteger(report.submissionEvidence?.attemptsReserved) && report.submissionEvidence.attemptsReserved >= 0 && report.submissionEvidence.attemptsReserved <= input.manifest.jobs.length, "invalid saved attempt count");
    const schema = stableJson(JSON.parse(await readFile(new URL("../../schemas/audio-review-evidence-v2.json", import.meta.url), "utf8")));
    assertMusic(report.responseSchemaSha256 === sha256Text(schema), "saved response schema differs from selected contract");
    const schemaBytes = await readBoundedScoreFile(join(dirname(path), "response-schema.json"));
    assertMusic(schemaBytes.toString("utf8") === schema, "saved schema bytes differ");
    const findings: SavedAudioObservation["findings"] = [];
    let validatedResponses = 0, comparedJobs = 0;
    for (const job of input.manifest.jobs) {
        const row = report.jobs.find((r: Record<string, unknown>) => r.id === job.id);
        assertMusic(row && row.mode === job.mode && row.phraseId === job.phraseId && row.media?.reference?.sha256 === job.referenceClip.sha256 && row.media?.candidate?.sha256 === job.candidateClip.sha256, "saved observation job/media mismatch");
        if (row.status !== "complete")
            continue;
        const responsePin = { path: join(dirname(path), "evidence", "responses", `${job.id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`), sha256: row.submission.responseSha256 };
        const raw = parseAntiLiveStdout((await readScorePin(responsePin)).toString("utf8"));
        const result = validateListenEnvelope(raw, { model: report.provider.requestedModel, resolvedModel: row.submission.resolvedModel, allowedModelIds: row.submission.allowedModelIds, mode: job.mode, durations: { reference: job.referenceClip.durationSeconds, candidate: job.candidateClip.durationSeconds }, expectedAudioHashes: [job.referenceClip.sha256, job.candidateClip.sha256], expectedAudioBytes: [job.referenceClip.bytes, job.candidateClip.bytes], reviewProfile: "evidence-v2", accountBinding: report.accountBinding ?? undefined });
        assertMusic(report.accountBinding, "saved bound observation lacks a binding receipt");
        validatedResponses++;
        if (result.comparisonStatus === "compared")
            comparedJobs++;
        findings.push(...result.findings.map(f => ({ mode: job.mode, phraseId: job.phraseId, startSeconds: f.startSeconds, reason: f.evidence })));
    }
    return { status: validatedResponses === input.manifest.jobs.length ? "validated" : "failed", reportSha256: createHash("sha256").update(bytes).digest("hex"), attemptsReserved: report.submissionEvidence.attemptsReserved, validatedResponses, comparedJobs, findings, reason: validatedResponses ? "Bound complete response contract only; provider observations remain advisory" : "No complete admitted audio response; local checks retained" };
}
const escape = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function scoreReportHtml(report: ScoreReviewReportV1): string {
    const checks = Object.entries(report.symbolic.modes).map(([mode, r]) => `<tr><th>${escape(mode)}</th><td>${escape(r.scoreConformance.status)}<small>${escape(r.scoreConformance.reason)}</small></td><td>${escape(r.sourceFidelity.status)}<small>${escape(r.sourceFidelity.reason)}</small></td><td>${escape(r.structuralPlayability.status)}<small>${escape(r.structuralPlayability.limitations.join(" "))}</small></td></tr>`).join("");
    const actions = buildScoreReviewRepairActions(report);
    const rows = report.findings.map(f => `<tr><td class="severity">${escape(f.severity)}</td><td>${escape(f.mode)}<small>${escape(f.phraseId)} / ${escape(f.occurrenceId)}</small></td><td>${f.startSeconds.toFixed(3)}s</td><td>${escape(f.kind)}<small>${escape(f.reason)}<br>${escape(f.basis)}</small></td><td>${escape(actions.find(a => a.findingId === f.id)?.reason ?? f.nextAction)}</td></tr>`).join("");
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Score Review: ${escape(report.title)}</title><style>*{box-sizing:border-box}body{margin:0;color:#202326;background:#f6f7f8;font:15px/1.5 system-ui,sans-serif;letter-spacing:0}header,main,footer{max-width:1200px;margin:auto;padding:24px}header{border-bottom:2px solid #41454b}h1{font-size:28px;line-height:1.2;margin:8px 0;overflow-wrap:anywhere}h2{font-size:20px;margin-top:32px}p,li,td,th,a{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;background:white;table-layout:fixed}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #d6d9dc}th{font-weight:600}small{display:block;color:#5c6269;font-size:13px;margin-top:6px}a{color:#145a49}a:focus-visible{outline:3px solid #165cba;outline-offset:3px}.severity{color:#a42938;font-weight:600}nav{display:flex;flex-wrap:wrap;gap:18px}.summary{display:flex;flex-wrap:wrap;gap:24px;border-bottom:1px solid #b8bdc2;padding:14px 0}.limit{border-left:3px solid #b78618;padding-left:12px}footer{color:#5c6269}@media(max-width:640px){header,main,footer{padding:16px}h1{font-size:24px}table,tbody,tr,td,th{display:block;width:100%}thead{display:none}tr{border-bottom:2px solid #aeb4ba}td,th{padding:8px 12px;border-bottom:0}}</style></head><body><header><p>Keyspilli / Score Review</p><h1>${escape(report.title)}</h1><div class="summary"><span>${report.findings.length} located findings</span><span>Source: ${escape(report.sourceAuthority)}</span><span>Audio: ${escape(report.lanes.audio.status)}</span></div></header><main><nav aria-label="Evidence"><a href="report.json">Report JSON</a><a href="symbolic-review.json">Symbolic Receipt</a><a href="structural-playability.json">Structural Receipt</a><a href="repair-queue.json">Repair Queue</a><a href="input.json">Pinned Input</a></nav><h2>Located Findings</h2>${rows ? `<table aria-label="Located findings"><thead><tr><th>Severity</th><th>Scope</th><th>Time</th><th>Finding / Origin</th><th>Next Action</th></tr></thead><tbody>${rows}</tbody></table>` : "<p>No located discrepancies in the checked subset. This is not an overall correctness verdict.</p>"}<h2>Checks and Coverage</h2><table aria-label="Check dispositions"><thead><tr><th>Mode</th><th>Literal Conformance</th><th>Source Fidelity</th><th>Structural Playability</th></tr></thead><tbody>${checks}</tbody></table><h2>Evidence Limits</h2><p class="limit">Musical acceptance: not established. Provider listening: unverified. Production admission: false.</p><ul>${[...report.limitations, report.lanes.audio.reason, report.lanes.realization.reason].map(l => `<li>${escape(l)}</li>`).join("")}</ul>${report.lanes.audio.status !== "not-run" && report.lanes.audio.findings.length ? `<h2>Advisory Audio Observations</h2><ul>${report.lanes.audio.findings.map(f => `<li>${escape(f.mode)} / ${escape(f.phraseId)} / ${f.startSeconds.toFixed(3)}s: ${escape(f.reason)}</li>`).join("")}</ul>` : ""}</main><footer>Diagnosis only. Catalog mutations: 0. No listening or pianist review task is assigned.</footer></body></html>`;
}
export async function writeScoreReviewReport(report: ScoreReviewReportV1, outputDir: string, updateOwned = false): Promise<void> {
    assertMusic(report.symbolic.code, "code-pinned receipt required for materialized report");
    if (!updateOwned)
        await mkdir(outputDir, { recursive: false, mode: 0o700 });
    else {
        const info = await lstat(outputDir);
        assertMusic(info.isDirectory() && !info.isSymbolicLink(), "cannot update symlinked output");
        assertMusic((await readBoundedScoreFile(join(outputDir, ".score-review-owner"))).toString("utf8") === report.inputSha256, "cannot update unrelated output");
    }
    const write = async (name: string, data: string) => {
        if (!updateOwned)
            await writeFile(join(outputDir, name), data, { flag: "wx", mode: 0o600 });
        else {
            const temp = join(outputDir, `${name}.${process.pid}.tmp`);
            await writeFile(temp, data, { flag: "wx", mode: 0o600 });
            await rename(temp, join(outputDir, name));
        }
    };
    const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
    await write(".score-review-owner", report.inputSha256);
    await write("input.json", json(report.input));
    await write("symbolic-review.json", json(report.symbolic));
    await write("normalized-inventories.json", json(report.inventories));
    await write("structural-playability.json", json(Object.fromEntries(Object.entries(report.symbolic.modes).map(([m, r]) => [m, r.structuralPlayability]))));
    await write("repair-queue.json", json(buildScoreReviewRepairActions(report)));
    await write("report.json", json(report));
    await write("report.md", `# Score Review: ${report.title.replace(/[\r\n]/g, " ")}\n\n${report.findings.length} located findings. Audio: ${report.lanes.audio.status}. Source authority: ${report.sourceAuthority}.\n\n${report.findings.map(f => `- ${f.severity}: ${f.mode}/${f.phraseId}/${f.occurrenceId} at ${f.startSeconds.toFixed(3)}s: ${f.reason}`).join("\n")}\n\nMusical acceptance not established; production admission false; catalog mutations 0.\n`);
    await write("index.html", scoreReportHtml(report));
    if (!updateOwned) {
        await mkdir(join(outputDir, "evidence"), { mode: 0o700 });
        const manifest = await readScoreJson(report.input.manifest) as NormalizedScoreReviewInput["manifest"];
        const pins = [report.input.manifest, manifest.source, ...Object.entries(report.input.modes).flatMap(([key, m]) => m ? [m.deliveredScore, manifest.replays[key as ReviewMode].noteEvents, m.clock.evidence, m.roles, m.hands, m.playerEvidence] : []), report.input.source.anchors, report.input.source.validationReceipt].filter((p): p is NonNullable<typeof p> => p !== null);
        const retained = new Set<string>();
        for (const p of pins) {
            if (retained.has(p.sha256))
                continue;
            retained.add(p.sha256);
            await writeFile(join(outputDir, "evidence", `${p.sha256}-${basename(p.path).replace(/[^\w.-]/g, "_")}`), await readScorePin(p), { flag: "wx", mode: 0o400 });
        }
    }
}
