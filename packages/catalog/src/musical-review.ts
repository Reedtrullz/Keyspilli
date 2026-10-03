/** Human attestations only. This contract never judges music or changes learner policy. */
export type MusicalReviewMode = "Original" | "Chords";
export interface MusicalOutputIdentity {
  baseId: string;
  variantId: string;
  mode: MusicalReviewMode;
  publicationRevision: string;
  sourceArtifactSha256: string;
  sourceFingerprint: string;
  playbackSha256: string;
}
export interface MusicalReviewCheck {
  result: "pending" | "passed" | "failed";
  evidence: {id: string; sha256: string}[];
}
export interface MusicalReviewReceipt extends MusicalOutputIdentity {
  schemaVersion: 1;
  kind: "musical-review-receipt";
  reviewer: {id: string; role: "owner" | "listener" | "pianist" | "teacher"; independent: boolean};
  reviewedAt: string;
  coverage: {startBeat: number; endBeat: number}[];
  decision: "pending" | "accepted" | "rejected";
  rationale: string;
  checks: {source: MusicalReviewCheck; listening: MusicalReviewCheck; keyboard: MusicalReviewCheck};
}
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,125}$/;
const keys = ["source", "listening", "keyboard"] as const;
const identityKeys = ["baseId", "variantId", "mode", "publicationRevision", "sourceArtifactSha256", "sourceFingerprint", "playbackSha256"] as const;
function object(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(" ") !== [...expected].sort().join(" ")) throw new Error("Malformed musical review receipt");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, pattern?: RegExp): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value) || (pattern && !pattern.test(value))) throw new Error("Invalid musical review field");
  return value;
}
function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) throw new Error("Unsupported musical review value");
  return value as T;
}
export function parseMusicalReviewReceipt(value: unknown): MusicalReviewReceipt {
  const raw = object(value, [...identityKeys, "schemaVersion", "kind", "reviewer", "reviewedAt", "coverage", "decision", "rationale", "checks"]);
  if (raw.schemaVersion !== 1 || raw.kind !== "musical-review-receipt") throw new Error("Unsupported musical review schema");
  const baseId = text(raw.baseId,120,ID), variantId = text(raw.variantId,126,ID);
  if (!variantId.startsWith(`${baseId}-`)) throw new Error("Review variant belongs to another base");
  const mode = choice(raw.mode,["Original","Chords"]);
  if (mode === "Chords" && variantId !== `${baseId}-a`) throw new Error("Chords review must identify Advanced input");
  const reviewer = object(raw.reviewer,["id","role","independent"]);
  const role = choice(reviewer.role,["owner","listener","pianist","teacher"]);
  if (typeof reviewer.independent !== "boolean") throw new Error("Reviewer independence must be explicit");
  const reviewedAt = text(raw.reviewedAt,40,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/);
  if (!Number.isFinite(Date.parse(reviewedAt))) throw new Error("Invalid review date");
  if (!Array.isArray(raw.coverage) || raw.coverage.length < 1 || raw.coverage.length > 64) throw new Error("Review coverage must be explicit and bounded");
  let end = -1;
  const coverage = raw.coverage.map(value => {
    const span = object(value,["startBeat","endBeat"]);
    if (typeof span.startBeat !== "number" || typeof span.endBeat !== "number"
      || !Number.isFinite(span.startBeat) || !Number.isFinite(span.endBeat) || span.startBeat < 0
      || span.endBeat <= span.startBeat || span.endBeat > 1e6 || span.startBeat < end) throw new Error("Invalid or overlapping review coverage");
    end = span.endBeat;
    return {startBeat:span.startBeat,endBeat:span.endBeat};
  });
  const rawChecks = object(raw.checks,keys);
  const checks = {} as MusicalReviewReceipt["checks"];
  for (const key of keys) {
    const check = object(rawChecks[key],["result","evidence"]);
    const result = choice(check.result,["pending","passed","failed"]);
    if (!Array.isArray(check.evidence) || check.evidence.length > 16 || (result !== "pending" && !check.evidence.length)) throw new Error("Completed checks require bounded evidence references");
    const evidence = check.evidence.map(value => {
      const ref = object(value,["id","sha256"]);
      return {id:text(ref.id,126,ID),sha256:text(ref.sha256,64,HASH)};
    });
    if (key === "keyboard" && result === "passed" && (!reviewer.independent || !["pianist","teacher"].includes(role))) throw new Error("Keyboard acceptance requires an independent pianist or teacher attestation");
    checks[key] = {result,evidence};
  }
  const decision = choice(raw.decision,["pending","accepted","rejected"]);
  if (decision === "accepted" && keys.some(key => checks[key].result === "failed")) throw new Error("Accepted review contradicts a failed check");
  return {schemaVersion:1,kind:"musical-review-receipt",baseId,variantId,mode,
    publicationRevision:text(raw.publicationRevision,128,/^[A-Za-z0-9_-]+$/),
    sourceArtifactSha256:text(raw.sourceArtifactSha256,64,HASH),sourceFingerprint:text(raw.sourceFingerprint,1024),
    playbackSha256:text(raw.playbackSha256,64,HASH),
    reviewer:{id:text(reviewer.id,126,ID),role,independent:reviewer.independent},reviewedAt,coverage,decision,
    rationale:text(raw.rationale,4096),checks};
}
export function sameMusicalOutput(left: MusicalOutputIdentity, right: MusicalOutputIdentity): boolean {
  return identityKeys.every(key => left[key] === right[key]);
}
export function parseMusicalOutputIdentity(value:unknown):MusicalOutputIdentity {
  const raw=object(value,identityKeys),baseId=text(raw.baseId,120,ID),variantId=text(raw.variantId,126,ID),mode=choice(raw.mode,["Original","Chords"]);
  if(!variantId.startsWith(`${baseId}-`)||(mode==="Chords"&&variantId!==`${baseId}-a`))throw new Error("Invalid musical output identity");
  return {baseId,variantId,mode,publicationRevision:text(raw.publicationRevision,128,/^[A-Za-z0-9_-]+$/),
    sourceArtifactSha256:text(raw.sourceArtifactSha256,64,HASH),sourceFingerprint:text(raw.sourceFingerprint,1024),playbackSha256:text(raw.playbackSha256,64,HASH)};
}
function fullCoverage(spans: MusicalReviewReceipt["coverage"], endBeat: number): boolean {
  let through = 0;
  for (const span of [...spans].sort((a,b)=>a.startBeat-b.startBeat)) {
    if (span.startBeat > through + 1e-6) return false;
    through = Math.max(through,span.endBeat);
  }
  return through >= endBeat - 1e-6;
}
export function summarizeMusicalReviews(receipts: readonly MusicalReviewReceipt[], identity: MusicalOutputIdentity, endBeat: number) {
  const relevant = receipts.filter(r=>r.variantId === identity.variantId && r.mode === identity.mode);
  const current = relevant.filter(r=>sameMusicalOutput(r,identity));
  const positive = current.filter(r=>r.decision === "accepted");
  const rejected = current.some(r=>r.decision === "rejected");
  const result = (key: typeof keys[number]): "pending" | "passed" | "partial" | "failed" => {
    if (current.some(r=>r.checks[key].result === "failed")) return "failed";
    const spans = positive.filter(r=>r.checks[key].result === "passed").flatMap(r=>r.coverage);
    return !spans.length ? "pending" : fullCoverage(spans,endBeat) ? "passed" : "partial";
  };
  const source=result("source"),listening=result("listening"),keyboard=result("keyboard");
  const status = rejected ? positive.length ? "conflict" : "rejected"
    : [source,listening,keyboard].every(r=>r === "passed") ? "accepted"
    : positive.length ? "partial" : "pending";
  return {mode:identity.mode,status,source,listening,keyboard,receiptCount:current.length,staleCount:relevant.length-current.length};
}

/** Publisher's binding to unchanged, reviewed candidate bytes; never a new human verdict. */
export interface MusicalPublicationBinding extends MusicalOutputIdentity {
  schemaVersion: 1;
  kind: "musical-publication-binding";
  reviewedPublicationRevision: string;
  candidateSha256: string;
  receiptSha256s: string[];
  ownerStatement: string;
  approvedModes: ["Chords"];
}
export function parseMusicalPublicationBinding(value: unknown): MusicalPublicationBinding {
  const raw=object(value,[...identityKeys,"schemaVersion","kind","reviewedPublicationRevision","candidateSha256","receiptSha256s","ownerStatement","approvedModes"]);
  if(raw.schemaVersion!==1||raw.kind!=="musical-publication-binding"||raw.mode!=="Chords"
    ||!Array.isArray(raw.approvedModes)||raw.approvedModes.length!==1||raw.approvedModes[0]!=="Chords"
    ||!Array.isArray(raw.receiptSha256s)||!raw.receiptSha256s.length||raw.receiptSha256s.length>16
    ||new Set(raw.receiptSha256s).size!==raw.receiptSha256s.length)throw new Error("Invalid musical publication binding");
  const baseId=text(raw.baseId,120,ID),variantId=text(raw.variantId,126,ID);
  if(variantId!==`${baseId}-a`)throw new Error("Invalid Chords binding identity");
  return {schemaVersion:1,kind:"musical-publication-binding",baseId,variantId,mode:"Chords",
    publicationRevision:text(raw.publicationRevision,128,/^[A-Za-z0-9_-]+$/),
    reviewedPublicationRevision:text(raw.reviewedPublicationRevision,128,/^[A-Za-z0-9_-]+$/),
    sourceArtifactSha256:text(raw.sourceArtifactSha256,64,HASH),sourceFingerprint:text(raw.sourceFingerprint,1024),
    playbackSha256:text(raw.playbackSha256,64,HASH),candidateSha256:text(raw.candidateSha256,64,HASH),
    receiptSha256s:raw.receiptSha256s.map(value=>text(value,64,HASH)),
    ownerStatement:text(raw.ownerStatement,4096),approvedModes:["Chords"]};
}
export function bindMusicalReviews(records: readonly {receiptSha256:string;receipt:MusicalReviewReceipt}[], identity:MusicalOutputIdentity, binding:MusicalPublicationBinding|null) {
  return records.map(({receiptSha256,receipt})=>{
    if(!binding||!sameMusicalOutput(binding,identity)||!binding.receiptSha256s.includes(receiptSha256))return receipt;
    const reviewed={...binding,publicationRevision:binding.reviewedPublicationRevision};
    return sameMusicalOutput(receipt,reviewed)?{...receipt,publicationRevision:identity.publicationRevision}:receipt;
  });
}
