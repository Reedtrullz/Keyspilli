import { NextResponse } from "next/server";

export class BodyTooLargeError extends Error {}
export class BodyDeadlineError extends Error {}

export async function readBoundedBody(req: Request, maxBytes = 16_384, deadlineMs = 5_000): Promise<Buffer> {
  if (req.signal.aborted) {
    void req.body?.cancel().catch(() => undefined);
    throw new BodyDeadlineError("body cancelled");
  }
  const contentLength = req.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (!Number.isInteger(declared) || declared < 0) throw new Error("invalid content length");
    if (declared > maxBytes) throw new BodyTooLargeError("body too large");
  }
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let stop!: () => void;
  const deadline = new Promise<never>((_, reject) => {
    stop = () => {
      reject(new BodyDeadlineError(req.signal.aborted ? "body cancelled" : "body read timed out"));
      void reader.cancel().catch(() => undefined);
    };
  });
  const timer = setTimeout(stop, deadlineMs);
  req.signal.addEventListener("abort", stop, { once: true });
  if (req.signal.aborted) stop();
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (req.signal.aborted) throw new BodyDeadlineError("body cancelled");
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new BodyTooLargeError("body too large");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    clearTimeout(timer);
    req.signal.removeEventListener("abort", stop);
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}


/** Caller applies its route authorization policy first; limits count actual bytes. */
export async function readJsonObject(req: Request, maxBytes = 16_384): Promise<{ body: Record<string, unknown>; response?: never } | { response: Response; body?: never }> {
  try {
    const value: unknown = JSON.parse((await readBoundedBody(req, maxBytes)).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return { body: value as Record<string, unknown> };
  } catch (error) {
    const status = error instanceof BodyDeadlineError ? 408 : error instanceof BodyTooLargeError ? 413 : 400;
    return { response: NextResponse.json({ error: status === 408 ? "Body read cancelled or timed out" : status === 413 ? `JSON body exceeds ${Math.ceil(maxBytes / 1024)} KiB` : "JSON object required" }, { status }) };
  }
}
