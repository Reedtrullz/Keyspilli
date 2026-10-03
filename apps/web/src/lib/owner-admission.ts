import {createHash,randomUUID} from "node:crypto";
import {lstat,mkdir,opendir,rename,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {
  dataDir,blockedLearnerBases,disabledManifestBases,parseMusicalReviewReceipt,
  readRecoveryDocument,sameMusicalOutput,summarizeMusicalReviews,withBaseArtifactLock,
  bindMusicalReviews,parseMusicalPublicationBinding,type MusicalOutputIdentity,type MusicalReviewMode,type MusicalReviewReceipt,
} from "@keyspilli/catalog";
import {getOwnerSongDetail,withStablePublication,PublicationRevisionConflictError} from "./catalog-api";
import {playerArrangementEnd,replayChordsBacking} from "../components/player/chords-backing";
import {snapshotChordsBacking} from "./chords-evaluation";

export const musicalHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function readMusicalBinding(baseId:string) {
  try {const binding=parseMusicalPublicationBinding(JSON.parse((await readRecoveryDocument(join(dataDir(),"artifacts",baseId,".musical-review-binding.json"),16384)).toString("utf8")));if(binding.baseId!==baseId)throw new Error("Review binding identity mismatch");return binding;}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}
}
export async function musicalOutput(baseId: string, variantId: string, mode: MusicalReviewMode, revision: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(baseId) || !variantId.startsWith(`${baseId}-`)
    || (mode === "Chords" && variantId !== `${baseId}-a`)) throw new Error("Invalid musical output identity");
  const detail = await getOwnerSongDetail(baseId,variantId,revision);
  if (!detail?.data || detail.artifact.status !== "valid" || !detail.artifact.manifest.sourceArtifactHash
    || !detail.data.sourceFingerprint) throw new Error("Exact musical output unavailable");
  const data = mode === "Chords" ? detail.chordData ?? detail.data : detail.data;
  if (mode === "Chords" && detail.chordUnavailableReason) throw new Error("Advanced Chords source unavailable");
  const endBeat = playerArrangementEnd(data);
  const snapshot = mode === "Chords" ? snapshotChordsBacking(data,replayChordsBacking(data)) : {
    schemaVersion:1,tempoBpm:data.tempoBpm,timeSig:data.timeSig,timeSigEvents:data.timeSigEvents ?? [],
    sourcePedal:data.sourcePedal ?? [],endBeatExclusive:endBeat,notes:data.notes,
  };
  const identity: MusicalOutputIdentity = {baseId,variantId,mode,publicationRevision:revision,
    sourceArtifactSha256:detail.artifact.manifest.sourceArtifactHash,
    sourceFingerprint:detail.data.sourceFingerprint,playbackSha256:musicalHash(snapshot)};
  return {identity,endBeat};
}

function reviewDirectory(baseId: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(baseId)) throw new Error("Invalid review identity");
  return join(dataDir(),"review-receipts",baseId);
}
async function safeDirectory(path: string, create = false) {
  if (create) await mkdir(path,{recursive:true});
  try {const info=await lstat(path);if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid review directory");return true;}
  catch(error) {if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;throw error;}
}
export async function readMusicalReviews(baseId: string) {
  const parent=join(dataDir(),"review-receipts"),directory=reviewDirectory(baseId);
  if (!await safeDirectory(parent) || !await safeDirectory(directory)) return [];
  const receipts: {receiptSha256:string;receipt:MusicalReviewReceipt}[]=[];
  const entries=await opendir(directory);
  let scanned=0;
  for await (const entry of entries) {
    if (++scanned>160) throw new Error("Review store directory exceeds bounds");
    if (entry.name.startsWith(".") && entry.name.endsWith(".tmp")) continue;
    if (receipts.length >= 128 || !entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) throw new Error("Review store exceeds bounds or contains malformed entries");
    const receipt=parseMusicalReviewReceipt(JSON.parse((await readRecoveryDocument(join(directory,entry.name),32768)).toString("utf8")));
    const receiptSha256=musicalHash(receipt);
    if (receipt.baseId !== baseId || entry.name !== `${receiptSha256}.json`) throw new Error("Stored review receipt identity mismatch");
    receipts.push({receiptSha256,receipt});
  }
  return receipts.sort((a,b)=>a.receiptSha256.localeCompare(b.receiptSha256));
}
/** Caller holds the existing per-base publication lock. Receipt history is immutable. */
export async function storeMusicalReview(receipt: MusicalReviewReceipt) {
  const directory=reviewDirectory(receipt.baseId),receiptSha256=musicalHash(receipt);
  const bytes=JSON.stringify(receipt)+"\n";
  if (Buffer.byteLength(bytes)>32768) throw new Error("Review receipt exceeds 32 KiB");
  const existing=await readMusicalReviews(receipt.baseId);
  if (existing.some(r=>r.receiptSha256 === receiptSha256)) return receiptSha256;
  if (existing.length >= 128) throw new Error("Review history limit reached; preserve history for operator review");
  await safeDirectory(join(dataDir(),"review-receipts"),true);
  await safeDirectory(directory,true);
  const temporary=join(directory,`.${randomUUID()}.tmp`);
  try {await writeFile(temporary,bytes,{flag:"wx",flush:true});await rename(temporary,join(directory,`${receiptSha256}.json`));}
  finally {await rm(temporary,{force:true});}
  return receiptSha256;
}
export function validateReviewOutput(receipt: MusicalReviewReceipt, output: {identity:MusicalOutputIdentity;endBeat:number}) {
  if (!sameMusicalOutput(receipt,output.identity)) throw new Error("Review output identity mismatch");
  if (receipt.coverage.some(span=>span.endBeat>output.endBeat+1e-6)) throw new Error("Review coverage exceeds exact output");
}
export async function importMusicalReview(raw: unknown, signal?: AbortSignal) {
  const receipt=parseMusicalReviewReceipt(raw);
  // Invalid policy must not be bypassed by an owner write; exclusions themselves remain unchanged.
  blockedLearnerBases();disabledManifestBases();
  return withBaseArtifactLock(receipt.baseId,{artifactsRoot:join(dataDir(),"artifacts")},async()=>{
    const stable=await withStablePublication(receipt.baseId,receipt.publicationRevision,async()=>{
      const output=await musicalOutput(receipt.baseId,receipt.variantId,receipt.mode,receipt.publicationRevision);
      validateReviewOutput(receipt,output);
      if (signal?.aborted) throw new PublicationRevisionConflictError();
      const receiptSha256=await storeMusicalReview(receipt);
      const records=await readMusicalReviews(receipt.baseId);
      return {receiptSha256,summary:summarizeMusicalReviews(bindMusicalReviews(records,output.identity,await readMusicalBinding(receipt.baseId)),output.identity,output.endBeat)};
    });
    return stable.value;
  });
}
