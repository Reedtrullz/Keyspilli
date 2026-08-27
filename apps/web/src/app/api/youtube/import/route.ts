import { NextRequest, NextResponse } from "next/server";
import { canonicalYoutubeUrl, getDb, getJob, insertJob } from "@keyspilli/catalog";

export const dynamic = "force-dynamic";

// The learner-facing importer intentionally has no login step. Keep this
// endpoint narrow: it can enqueue one URL-only conversion, while metadata,
// re-transcription, retry, delete, uploads, and song edits stay on the
// bearer-protected maintainer routes.
const RATE_LIMIT = 2;
const RATE_WINDOW_MS = 60_000;
const ACTIVE_QUEUE_LIMIT = 2;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const publicJobByIp = new Map<string, { id: string; expiresAt: number }>();
const PUBLIC_JOB_TTL_MS = 30 * 60_000;
let lastCleanup = Date.now();

function jsonError(error: string, status: number, retryAfter?: number): Response {
  const headers: HeadersInit = { "Cache-Control": "no-store" };
  if (retryAfter !== undefined) headers["Retry-After"] = String(retryAfter);
  return NextResponse.json({ error }, { status, headers });
}

function sameOriginGuard(req: Request): Response | null {
  // Fetch metadata lets browsers identify cross-site requests even when an
  // Origin header is omitted. Non-browser callers remain supported when the
  // metadata is absent, which keeps the endpoint useful for local operators.
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return jsonError("cross-origin request rejected", 403);
  }
  const origin = req.headers.get("origin");
  if (!origin) return null;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return jsonError("cross-origin request rejected", 403);
  }
  const requestHost = (req.headers.get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  if (!requestHost || parsed.hostname.toLowerCase() !== requestHost) {
    return jsonError("cross-origin request rejected", 403);
  }
  return null;
}

function cleanup(now: number): void {
  if (now - lastCleanup <= RATE_WINDOW_MS) return;
  lastCleanup = now;
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
  for (const [key, entry] of publicJobByIp) {
    if (now > entry.expiresAt) publicJobByIp.delete(key);
  }
}

function checkRateLimit(ip: string, now = Date.now()): Response | null {
  cleanup(now);
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return null;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT) {
    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return jsonError("too many import requests, try again later", 429, retryAfter);
  }
  return null;
}

function checkCapacity(ip: string, canonicalUrl: string): Response | null {
  const previousEntry = publicJobByIp.get(ip);
  if (previousEntry) {
    const previous = getJob(previousEntry.id);
    if (previous && (previous.status === "queued" || previous.status === "processing")) {
      return jsonError("an import from this browser is already running", 429, 30);
    }
    publicJobByIp.delete(ip);
  }

  const db = getDb();
  const active = db
    .prepare("SELECT COUNT(*) AS count FROM conversion_jobs WHERE status IN ('queued', 'processing')")
    .get() as { count: number };
  if (active.count >= ACTIVE_QUEUE_LIMIT) {
    return jsonError("the importer is busy; try again when the current jobs finish", 429, 60);
  }
  const duplicate = db
    .prepare("SELECT id FROM conversion_jobs WHERE youtube_url = ? AND status IN ('queued', 'processing') LIMIT 1")
    .get(canonicalUrl) as { id?: string } | undefined;
  if (duplicate?.id) return jsonError("this video is already queued or processing", 409);
  return null;
}

function validYoutubeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (parsed.protocol !== "https:" || !["youtube.com", "youtu.be", "m.youtube.com", "music.youtube.com"].includes(host)) {
    return null;
  }
  return canonicalYoutubeUrl(input);
}

export async function POST(req: NextRequest) {
  const originResponse = sameOriginGuard(req);
  if (originResponse) return originResponse;

  const raw = await req.json().catch(() => null);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return jsonError("public import accepts a JSON object containing only url", 400);
  }
  const body = raw as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "url") {
    return jsonError("public import accepts only url; use the protected maintainer route for overrides", 400);
  }
  const canonicalUrl = validYoutubeUrl(body.url);
  if (!canonicalUrl) return jsonError("paste a valid YouTube URL", 400);

  const ip = req.headers.get("x-real-ip") || "unknown";
  const rateLimitResponse = checkRateLimit(ip);
  if (rateLimitResponse) return rateLimitResponse;
  const capacityResponse = checkCapacity(ip, canonicalUrl);
  if (capacityResponse) return capacityResponse;

  const id = `job-${crypto.randomUUID()}`;
  insertJob({
    id,
    youtubeUrl: canonicalUrl,
    status: "queued",
    songId: null,
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  });
  publicJobByIp.set(ip, { id, expiresAt: Date.now() + PUBLIC_JOB_TTL_MS });
  return NextResponse.json({ jobId: id }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
