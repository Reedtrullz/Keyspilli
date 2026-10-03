import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, opendir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir, getDb, getSongsByBase, blockedLearnerBases, disabledManifestBases, quarantinedBaseIds, readRecoveryDocument, parseMusicalOutputIdentity, parseMusicalReviewReceipt, parseMusicalPublicationBinding, sameMusicalOutput, summarizeMusicalReviews, publishBaseArtifact, withBaseArtifactLock, manifestLevels, artifactPublicationRevision, commitCatalogPublication, type CatalogPublication, type MusicalOutputIdentity, } from "@keyspilli/catalog";
import { getOwnerSongDetail, loadSongArtifact, withStablePublication, PublicationRevisionConflictError } from "./catalog-api";
import { buildHarmonyCandidate, type HarmonyDraftEvent } from "./harmony-candidate";
import { musicalHash, musicalOutput, readMusicalBinding, readMusicalReviews, storeMusicalReview, validateReviewOutput } from "./owner-admission";
import { retainedUploadForManifest } from "./song-update";
import { snapshotChordsBacking } from "./chords-evaluation";
import { replayChordsBacking } from "../components/player/chords-backing";
const HASH = /^[a-f0-9]{64}$/;
const byteHash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const fileBounds = { "timeline.json": 131072, "backing.mid": 1048576, "backing.musicxml": 4194304, "previous-player.json": 8388608 };
type FrozenFiles = {
    [K in keyof typeof fileBounds]: string;
};
interface Preparation {
    schemaVersion: 1;
    kind: "harmony-preparation-receipt";
    status: "provisional";
    identity: MusicalOutputIdentity;
    endBeat: number;
    events: HarmonyDraftEvent[];
    previewDigest: string;
    warnings: string[];
    files: FrozenFiles;
}
function exact(value: unknown, fields: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(" ") !== fields.split(" ").sort().join(" "))
        throw new Error("Invalid harmony request or frozen receipt");
    return value as Record<string, unknown>;
}
function baseFor(id: string) {
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,125}$/.test(id))
        throw new Error("Invalid harmony variant");
    const row = getDb().prepare("SELECT base_id FROM songs WHERE id=?").get(id) as {
        base_id: string;
    } | undefined;
    if (!row || id !== `${row.base_id}-a` || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(row.base_id) || quarantinedBaseIds().has(row.base_id))
        throw new Error("Exact Advanced source unavailable");
    return row.base_id;
}
async function source(id: string, revision: string) {
    if (typeof revision !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(revision))
        throw new Error("Invalid harmony publication revision");
    const baseId = baseFor(id);
    blockedLearnerBases();
    disabledManifestBases();
    return (await withStablePublication(baseId, revision, async () => {
        const row = getSongsByBase(baseId).find(row => row.id === id)!;
        if (!row)
            throw new Error("Advanced source unavailable");
        const loaded = await loadSongArtifact(row);
        if (loaded.artifact.status !== "valid" || !loaded.artifact.manifest.sourceArtifactHash || !loaded.data?.sourceFingerprint || loaded.data.notes.length > 20000 || loaded.data.measures.length > 2048)
            throw new Error("Bounded exact Advanced source unavailable");
        return { baseId, row, data: loaded.data, manifest: loaded.artifact.manifest };
    })).value;
}
function directory(baseId: string, sha?: string) {
    if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(baseId) || (sha !== undefined && !HASH.test(sha)))
        throw new Error("Invalid candidate identity");
    return join(dataDir(), "harmony-candidates", baseId, ...(sha ? [sha] : []));
}
async function safeDirectory(path: string, create = false) {
    if (create)
        await mkdir(path, { recursive: true });
    try {
        const info = await lstat(path);
        if (!info.isDirectory() || info.isSymbolicLink())
            throw new Error("Invalid candidate directory");
        return true;
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return false;
        throw error;
    }
}
async function candidateIds(baseId: string) {
    if (!await safeDirectory(join(dataDir(), "harmony-candidates")) || !await safeDirectory(directory(baseId)))
        return [];
    const ids: string[] = [], entries = await opendir(directory(baseId));
    let scanned = 0;
    for await (const entry of entries) {
        if (++scanned > 32)
            throw new Error("Candidate directory exceeds bounds");
        if (entry.name.startsWith(".") && entry.name.endsWith(".tmp"))
            continue;
        if (ids.length >= 16 || !entry.isDirectory() || !HASH.test(entry.name))
            throw new Error("Candidate history unavailable or exceeds 16 candidates");
        ids.push(entry.name);
    }
    return ids.sort();
}
async function frozen(baseId: string, sha: string) {
    if (!await safeDirectory(join(dataDir(), "harmony-candidates")) || !await safeDirectory(directory(baseId)) || !await safeDirectory(directory(baseId, sha)))
        throw new Error("Frozen candidate unavailable");
    const path = directory(baseId, sha), raw = exact(JSON.parse((await readRecoveryDocument(join(path, "receipt.json"), 65536)).toString("utf8")), "schemaVersion kind status identity endBeat events previewDigest warnings files");
    const identity = parseMusicalOutputIdentity(raw.identity);
    if (raw.schemaVersion !== 1 || raw.kind !== "harmony-preparation-receipt" || raw.status !== "provisional" || identity.baseId !== baseId || identity.mode !== "Chords"
        || typeof raw.endBeat !== "number" || !Number.isFinite(raw.endBeat) || raw.endBeat <= 0 || raw.endBeat > 1e6 || !Array.isArray(raw.events) || !raw.events.length || raw.events.length > 256
        || typeof raw.previewDigest !== "string" || !HASH.test(raw.previewDigest) || !Array.isArray(raw.warnings) || raw.warnings.length > 256 || raw.warnings.some(w => typeof w !== "string" || w.length > 512))
        throw new Error("Malformed frozen preparation receipt");
    const refs = exact(raw.files, Object.keys(fileBounds).join(" "));
    if (Object.values(refs).some(hash => typeof hash !== "string" || !HASH.test(hash)))
        throw new Error("Invalid frozen file hashes");
    const record = { ...raw, identity } as unknown as Preparation;
    if (musicalHash(record) !== sha)
        throw new Error("Frozen candidate receipt hash mismatch");
    const files = {} as Record<keyof typeof fileBounds, Buffer>;
    for (const name of Object.keys(fileBounds) as (keyof typeof fileBounds)[]) {
        const bytes = await readRecoveryDocument(join(path, name), fileBounds[name]);
        if (byteHash(bytes) !== record.files[name])
            throw new Error("Frozen candidate file hash mismatch");
        files[name] = bytes;
    }
    return { record, files };
}
function compile(saved: Preparation, original: Awaited<ReturnType<typeof source>>) {
    const { row, data, manifest } = original;
    if (saved.identity.sourceArtifactSha256 !== manifest.sourceArtifactHash || saved.identity.sourceFingerprint !== data.sourceFingerprint)
        throw new PublicationRevisionConflictError();
    const candidate = buildHarmonyCandidate(data, { id: row.id, baseId: row.baseId, title: row.title, artist: row.artist, revision: saved.identity.publicationRevision }, saved.events);
    if (candidate.digest !== saved.previewDigest || candidate.playbackSha256 !== saved.identity.playbackSha256
        || byteHash(JSON.stringify(candidate.timeline) + "\n") !== saved.files["timeline.json"] || byteHash(Buffer.from(candidate.midi, "base64")) !== saved.files["backing.mid"] || byteHash(candidate.xml) !== saved.files["backing.musicxml"])
        throw new Error("Frozen candidate no longer matches its compiler output; prepare a new preview");
    return candidate;
}
async function info(sha: string, record: Preparation) {
    const records = await readMusicalReviews(record.identity.baseId), receipts = records.map(r => r.receipt);
    return { candidateSha256: sha, identity: record.identity, endBeat: record.endBeat, warnings: record.warnings, files: record.files,
        summary: summarizeMusicalReviews(receipts, record.identity, record.endBeat), receiptSha256s: records.filter(r => sameMusicalOutput(r.receipt, record.identity) && r.receipt.decision === "accepted").map(r => r.receiptSha256) };
}
export async function saveHarmonyCandidate(input: unknown, signal?: AbortSignal) {
    const body = exact(input, "id revision sourceFingerprint events previewDigest previewPlaybackSha256"), id = body.id as string, baseId = baseFor(id);
    return withBaseArtifactLock(baseId, { artifactsRoot: join(dataDir(), "artifacts") }, async () => {
        const original = await source(id, body.revision as string), { row, data, manifest } = original;
        if (body.sourceFingerprint !== data.sourceFingerprint)
            throw new PublicationRevisionConflictError();
        const candidate = buildHarmonyCandidate(data, { id, baseId, title: row.title, artist: row.artist, revision: body.revision as string }, body.events);
        if (candidate.digest !== body.previewDigest || candidate.playbackSha256 !== body.previewPlaybackSha256)
            throw new Error("Preview changed; validate the exact candidate again");
        const previous = await getOwnerSongDetail(baseId, id, body.revision as string), previousData = previous?.chordData ?? previous?.data;
        if (!previousData)
            throw new Error("Previous backing unavailable for preservation");
        const files: Record<keyof typeof fileBounds, Buffer> = { "timeline.json": Buffer.from(JSON.stringify(candidate.timeline) + "\n"), "backing.mid": Buffer.from(candidate.midi, "base64"), "backing.musicxml": Buffer.from(candidate.xml), "previous-player.json": Buffer.from(JSON.stringify({ data: previousData, snapshot: snapshotChordsBacking(previousData, replayChordsBacking(previousData)) }) + "\n") };
        for (const name of Object.keys(fileBounds) as (keyof typeof fileBounds)[])
            if (files[name].length > fileBounds[name])
                throw new Error("Frozen candidate file exceeds bounds");
        const identity: MusicalOutputIdentity = { baseId, variantId: id, mode: "Chords", publicationRevision: body.revision as string, sourceArtifactSha256: manifest.sourceArtifactHash!, sourceFingerprint: data.sourceFingerprint!, playbackSha256: candidate.playbackSha256 };
        const record: Preparation = { schemaVersion: 1, kind: "harmony-preparation-receipt", status: "provisional", identity, endBeat: candidate.timeline.durationBeats, events: body.events as HarmonyDraftEvent[], previewDigest: candidate.digest, warnings: candidate.warnings, files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, byteHash(bytes)])) as FrozenFiles };
        const sha = musicalHash(record), existing = await candidateIds(baseId);
        if (existing.includes(sha)) {
            await frozen(baseId, sha);
            return info(sha, record);
        }
        if (existing.length >= 16 || Buffer.byteLength(JSON.stringify(record)) > 65536)
            throw new Error("Candidate history or preparation exceeds bounds; preserve existing candidates");
        await safeDirectory(join(dataDir(), "harmony-candidates"), true);
        await safeDirectory(directory(baseId), true);
        const temporary = join(directory(baseId), `.${randomUUID()}.tmp`);
        await mkdir(temporary);
        try {
            for (const [name, bytes] of Object.entries(files))
                await writeFile(join(temporary, name), bytes, { flag: "wx", flush: true });
            await writeFile(join(temporary, "receipt.json"), JSON.stringify(record) + "\n", { flag: "wx", flush: true });
            if (signal?.aborted)
                throw new Error("Candidate save canceled");
            await rename(temporary, directory(baseId, sha));
        }
        finally {
            await rm(temporary, { recursive: true, force: true });
        }
        return info(sha, record);
    });
}
export async function listHarmonyCandidates(id: string, revision: string) {
    return (await withStablePublication(baseFor(id), revision, async () => {
        const original = await source(id, revision), baseId = original.baseId, entries = [];
        for (const sha of await candidateIds(baseId)) {
            const { record } = await frozen(baseId, sha);
            entries.push({ ...await info(sha, record), stale: record.identity.publicationRevision !== revision || record.identity.sourceFingerprint !== original.data.sourceFingerprint });
        }
        return { entries };
    })).value;
}
export async function getHarmonyCandidate(id: string, revision: string, sha: string) {
    return (await withStablePublication(baseFor(id), revision, async () => {
        const original = await source(id, revision), { record } = await frozen(original.baseId, sha);
        if (record.identity.publicationRevision !== revision)
            throw new PublicationRevisionConflictError();
        return { ...await info(sha, record), events: record.events, candidate: compile(record, original) };
    })).value;
}
export async function importHarmonyReview(id: string, revision: string, sha: string, raw: unknown, signal?: AbortSignal) {
    const receipt = parseMusicalReviewReceipt(raw), baseId = baseFor(id);
    return withBaseArtifactLock(baseId, { artifactsRoot: join(dataDir(), "artifacts") }, async () => {
        const original = await source(id, revision), { record } = await frozen(baseId, sha);
        compile(record, original);
        if (record.identity.publicationRevision !== revision)
            throw new PublicationRevisionConflictError();
        validateReviewOutput(receipt, { identity: record.identity, endBeat: record.endBeat });
        if (signal?.aborted)
            throw new Error("Review import canceled");
        const receiptSha256 = await storeMusicalReview(receipt);
        return { receiptSha256, ...await info(sha, record) };
    });
}
async function copyOriginalTree(from: string, to: string) {
    let count = 0, total = 0;
    async function walk(relative: string) {
        const dir = join(from, relative), dirInfo = await lstat(dir);
        if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink())
            throw new Error("Original tree contains unsafe directories");
        await mkdir(join(to, relative), { recursive: true });
        const entries = await opendir(dir);
        for await (const entry of entries) {
            if (++count > 4096)
                throw new Error("Original preservation exceeds 4096 entries");
            const child = join(relative, entry.name), info = await lstat(join(from, child));
            if (info.isDirectory() && !info.isSymbolicLink())
                await walk(child);
            else if (info.isFile() && !info.isSymbolicLink()) {
                total += info.size;
                if (total > 128 * 1024 * 1024)
                    throw new Error("Original preservation exceeds 128 MiB");
                const bytes = await readRecoveryDocument(join(from, child), info.size);
                await writeFile(join(to, child), bytes, { flag: "wx", flush: true });
            }
            else
                throw new Error("Original tree contains an unsafe entry");
        }
    }
    await walk("");
}
export async function publishHarmonyCandidate(input: unknown, signal?: AbortSignal) {
    const body = exact(input, "id revision candidateSha256 receiptSha256s ownerStatement approvedModes"), id = body.id as string, baseId = baseFor(id), sha = body.candidateSha256 as string;
    if (!HASH.test(sha) || !Array.isArray(body.receiptSha256s) || !body.receiptSha256s.length || body.receiptSha256s.length > 16 || new Set(body.receiptSha256s).size !== body.receiptSha256s.length || body.receiptSha256s.some(hash => typeof hash !== "string" || !HASH.test(hash)) || typeof body.ownerStatement !== "string" || body.ownerStatement.trim().length < 12 || body.ownerStatement.length > 4096 || !Array.isArray(body.approvedModes) || body.approvedModes.length !== 1 || body.approvedModes[0] !== "Chords")
        throw new Error("Exact review receipts and separate owner publication authorization are required");
    if (signal?.aborted)
        throw new Error("Publication canceled");
    const receiptSha256s = body.receiptSha256s as string[];
    const publication: CatalogPublication = { baseId, rows: [] };
    return publishBaseArtifact(baseId, async (stage, publicationId) => {
        const original = await source(id, body.revision as string), { record } = await frozen(baseId, sha), candidate = compile(record, original);
        if (record.identity.publicationRevision !== body.revision)
            throw new PublicationRevisionConflictError();
        const records = await readMusicalReviews(baseId), selected = records.filter(r => receiptSha256s.includes(r.receiptSha256));
        if (selected.length !== receiptSha256s.length || selected.some(r => !sameMusicalOutput(r.receipt, record.identity)) || summarizeMusicalReviews(selected.map(r => r.receipt), record.identity, record.endBeat).status !== "accepted" || summarizeMusicalReviews(records.map(r => r.receipt), record.identity, record.endBeat).status !== "accepted")
            throw new Error("Complete source, listening and independent keyboard review without conflicts is required");
        Object.assign(publication, { rows: getSongsByBase(baseId), ...(original.manifest.symbolicIntent ? { symbolicIntent: original.manifest.symbolicIntent, upload: await retainedUploadForManifest(baseId, original.manifest) } : {}) });
        await copyOriginalTree(join(dataDir(), "artifacts", baseId), stage);
        const binding = parseMusicalPublicationBinding({ ...record.identity, publicationRevision: publicationId, schemaVersion: 1, kind: "musical-publication-binding", reviewedPublicationRevision: body.revision, candidateSha256: sha, receiptSha256s: body.receiptSha256s, ownerStatement: body.ownerStatement, approvedModes: body.approvedModes });
        const timelineBytes=JSON.stringify({ ...candidate.timeline, provenance: { ...candidate.timeline.provenance, sourceRef: `prepared:${original.data.sourceFingerprint}` } }) + "\n";
        const bindingBytes=JSON.stringify(binding) + "\n";
        publication.harmony={timelineSha256:byteHash(timelineBytes),bindingSha256:byteHash(bindingBytes),publicationRevision:publicationId};
        await writeFile(join(stage, "chord-timeline.json"), timelineBytes, { flush: true });
        await writeFile(join(stage, ".musical-review-binding.json"), bindingBytes, { flush: true });
        return { publicationRevision: publicationId, candidateSha256: sha, idempotent: false };
    }, { artifactsRoot: join(dataDir(), "artifacts"), semanticValidation: "strict", requiredLevels: await (async () => { const current = await source(id, body.revision as string).catch(error => { if (error instanceof PublicationRevisionConflictError)
            return null; throw error; }); return current ? manifestLevels(current.manifest) : undefined; })(), recoveryData: publication,
        reuseExisting: async () => { const binding = await readMusicalBinding(baseId); if (!binding || binding.candidateSha256 !== sha || binding.reviewedPublicationRevision !== body.revision || binding.ownerStatement !== body.ownerStatement || JSON.stringify(binding.receiptSha256s) !== JSON.stringify(receiptSha256s) || await artifactPublicationRevision(baseId, join(dataDir(), "artifacts")) !== binding.publicationRevision)
            return undefined; const output = await musicalOutput(baseId, id, "Chords", binding.publicationRevision); if (!sameMusicalOutput(binding, output.identity))
            return undefined; const { record } = await frozen(baseId, sha), records = await readMusicalReviews(baseId), selected = records.filter(r => receiptSha256s.includes(r.receiptSha256)); if (selected.length !== receiptSha256s.length || summarizeMusicalReviews(selected.map(r => r.receipt), record.identity, record.endBeat).status !== "accepted")
            throw new Error("Published candidate review evidence unavailable"); return { publicationRevision: binding.publicationRevision, candidateSha256: sha, idempotent: true }; },
        beforeSwap: () => { if (signal?.aborted)
            throw new Error("Publication canceled before replacement"); }, afterSwap: () => commitCatalogPublication(publication) });
}
