import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { canonicalYoutubeUrl, insertJob, getSongsByBase } from "@keyspilli/catalog";
import { applySongMetadata, resolveBaseId, SongUpdateError, type SongPatch } from "@/lib/song-update";
import { parseTempoRequest, TempoRequestError, type TempoRequestPatch } from "@/lib/tempo-request";
import { apiAuthorization } from "../../../lib/api-auth";

export const dynamic = "force-dynamic";

function checkAuth(req: Request): Response | null {
  const token = process.env.KEYSPILLI_API_TOKEN;
  if (!token) {
    console.error("KEYSPILLI_API_TOKEN is not configured; rejecting mutation request");
    return NextResponse.json(
      { error: "server authentication is not configured" },
      { status: 503 },
    );
  }
  const auth = apiAuthorization(req);
  const provided = Buffer.from(auth);
  const expected = Buffer.from(`Bearer ${token}`);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
let lastCleanup = Date.now();

function checkRateLimit(ip: string): Response | null {
  const now = Date.now();
  if (now - lastCleanup > RATE_WINDOW_MS) {
    lastCleanup = now;
    for (const [key, entry] of rateLimitMap) {
      if (now > entry.resetAt) rateLimitMap.delete(key);
    }
  }
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return null;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT) {
    return NextResponse.json({ error: "too many requests, try again later" }, { status: 429 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const authResponse = checkAuth(req);
  if (authResponse) return authResponse;
  // Caddy sets X-Real-IP from the actual remote address; X-Forwarded-For
  // can be spoofed by clients when no trusted proxy overwrites it.
  const ip = req.headers.get("x-real-ip") || "unknown";
  const rateLimitResponse = checkRateLimit(ip);
  if (rateLimitResponse) return rateLimitResponse;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const url = typeof body.url === "string" ? body.url.trim() : "";
  let parsedUrl: URL | undefined;
  try {
    parsedUrl = new URL(url);
  } catch {
    parsedUrl = undefined;
  }
  const host = parsedUrl?.hostname.toLowerCase().replace(/^www\./, "");
  const canonicalUrl = canonicalYoutubeUrl(url);
  if (
    !canonicalUrl ||
    parsedUrl?.protocol !== "https:" ||
    !["youtube.com", "youtu.be", "m.youtube.com", "music.youtube.com"].includes(host ?? "")
  ) {
    return NextResponse.json({ error: "paste a valid YouTube URL" }, { status: 400 });
  }
  if (body.songId !== undefined && typeof body.songId !== "string") {
    return NextResponse.json({ error: "songId must be a string" }, { status: 400 });
  }
  const patch = {} as SongPatch & TempoRequestPatch;
  for (const k of ["title", "artist", "key"] as const) {
    const v = body[k];
    if (v !== undefined) {
      if (typeof v !== "string") return NextResponse.json({ error: `${k} must be a string` }, { status: 400 });
      patch[k] = v;
    }
  }
  let tempoRole: ReturnType<typeof parseTempoRequest>["role"];
  try {
    const tempo = parseTempoRequest(body);
    Object.assign(patch, tempo.patch);
    tempoRole = tempo.role;
  } catch (e) {
    if (e instanceof TempoRequestError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  const hasMeta = Object.values(patch).some((v) => v !== undefined);
  if (hasMeta && !body.songId) {
    return NextResponse.json({ error: "songId is required with metadata" }, { status: 400 });
  }
  let songId: string | null = null;
  try {
    if (body.songId) {
      const baseId = resolveBaseId(body.songId);
      if (!baseId) return NextResponse.json({ error: "song not found" }, { status: 404 });
      songId = getSongsByBase(baseId)[0]?.id ?? body.songId;
      if (hasMeta) await applySongMetadata(songId, patch);
    }
  } catch (e) {
    if (e instanceof SongUpdateError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  const id = `job-${crypto.randomUUID()}`;
  insertJob({
    id,
    youtubeUrl: canonicalUrl,
    status: "queued",
    songId,
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  });
  return NextResponse.json({ jobId: id, tempoRole });
}
