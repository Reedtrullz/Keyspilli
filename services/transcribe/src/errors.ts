import { readFileSync } from "node:fs";

/**
 * Keep subprocess failures useful to operators without persisting the full
 * execFile message. Node includes the complete command line in that message,
 * which would expose a proxy URL (and any embedded credentials) through the
 * public conversion-job status endpoint.
 */
export function sanitizeProcessError(error: unknown, fallback = "command failed"): Error {
  const record = error && typeof error === "object" ? error as {
    stderr?: unknown;
    stdout?: unknown;
    code?: unknown;
  } : {};
  const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
  const stdout = typeof record.stdout === "string" ? record.stdout.trim() : "";
  const code = typeof record.code === "string" ? record.code : "";
  const detail = stderr || stdout || (code === "ETIMEDOUT" ? "command timed out" : fallback);
  return new Error(redactSensitiveText(detail));
}

/** Redact URL credentials and worker-controlled sensitive flags from errors. */
export function redactSensitiveText(value: string): string {
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, "$1[redacted]@")
    .replace(/(--(?:proxy|cookies(?:-from-browser)?))(?:=|\s+)([^\s]+)/gi, "$1 [redacted]");
}

const YOUTUBE_BOT_PATTERNS = [
  /sign in to confirm/i,
  /confirm you(?:'|’)re not a bot/i,
  /login_required/i,
  /bot.?check/i,
];

/** YouTube blocks should fail once; retrying every client hammers the IP. */
export function isYoutubeBotChallenge(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return YOUTUBE_BOT_PATTERNS.some((pattern) => pattern.test(message));
}

export const YOUTUBE_BOT_BLOCK_MESSAGE =
  "YouTube blocked server-side extraction (bot check); configure a trusted proxy or cookie session, or pre-seed the audio file.";

export const RESOURCE_BLOCKED_MESSAGE = "RESOURCE_BLOCKED: worker runtime exhausted memory or process capacity; review limits before retrying";
export function isResourceBlocked(error: unknown): boolean {
  return error instanceof Error && error.message === RESOURCE_BLOCKED_MESSAGE;
}
type ResourceEvents = { oomKill: number | null; oom?:number|null; pidsMax: number | null };
function eventCount(file: string, key: string): number | null {
  try {
    const text=readFileSync(`/sys/fs/cgroup/${file}`,"utf8");
    if(text.length>4096)return null;
    const value=text.split("\n").find(line=>line.startsWith(key+" "))?.split(/\s+/)[1];
    return value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
  } catch { return null; }
}
function resourceEvents(): ResourceEvents {return {oomKill:eventCount("memory.events","oom_kill"),oom:eventCount("memory.events","oom"),pidsMax:eventCount("pids.events","max")};}
export function resourceFailure(error: unknown, before: ResourceEvents, after: ResourceEvents): Error | null {
  const increased=(a:number|null,b:number|null)=>a!==null&&b!==null&&b>a;
  if(error && typeof error==="object" && (("code" in error && ["ABORT_ERR","ETIMEDOUT"].includes(String(error.code))) || ("killed" in error && error.killed===true) || (error instanceof Error && /^SOURCE_REVIEW_REQUIRED: tutorial operation (?:cancelled|timed out)$/.test(error.message))))return null;
  // ponytail: cgroup-wide counters prove capacity pressure, not which child consumed it.
  if(isResourceBlocked(error)||(error && typeof error==="object" && "code" in error && ["EAGAIN","ENOMEM"].includes(String(error.code)))||increased(before.oomKill,after.oomKill)||increased(before.oom??null,after.oom??null)||increased(before.pidsMax,after.pidsMax))return Error(RESOURCE_BLOCKED_MESSAGE);
  return null; // SIGKILL/137 alone is not OOM evidence; cancellation and timeouts retain their own reason.
}
export async function withResourceAccounting<T>(run:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
  const before=resourceEvents();
  try{return await run();}catch(error){if(!signal?.aborted)throw resourceFailure(error,before,resourceEvents())??error;throw error;}
}
