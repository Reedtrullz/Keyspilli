import { pathToFileURL } from "node:url";

/** Read-only HTTP proof inside the network-disabled restore container. */
export async function verifyRestoredApp(revision, songId, epoch, request = fetch) {
  const origin = "http://127.0.0.1:3000";
  async function get(path, maxBytes = 16 * 1024 * 1024, timeoutMs = 20_000) {
    const response = await request(origin + path, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error("restored endpoint unavailable");
    const chunks = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) throw new Error("restored response exceeds verification bound");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return Buffer.concat(chunks);
  }
  const health = JSON.parse((await get("/api/health", 32_768)).toString());
  if (health.status !== "healthy" || health.version !== revision
      || health.readiness?.catalog?.schemaEpoch !== epoch) throw new Error("restore identity/schema mismatch");
  const detail = JSON.parse((await get(`/api/songs/${songId}`)).toString());
  if (detail.song?.id !== songId || !Array.isArray(detail.data?.notes) || !detail.data.notes.length) {
    throw new Error("restored player artifact unavailable");
  }
  const page = await get(`/player/${songId}`);
  if (!page.toString().includes("<html")) throw new Error("restored player document unavailable");
  const midi = await get(`/api/song/${songId}/export?type=midi`);
  const xml = await get(`/api/song/${songId}/export?type=musicxml`);
  if (midi.subarray(0, 4).toString() !== "MThd" || !/<score-(partwise|timewise)\b/.test(xml.toString())) {
    throw new Error("restored symbolic export invalid");
  }
  for (const layout of ["simplify", "classic"]) {
    const pdf = await get(`/api/song/${songId}/export?type=pdf&layout=${layout}`, 32 * 1024 * 1024, 95_000);
    if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("restored PDF invalid");
  }
  return { health: "passed", playerDocument: "passed", midi: "passed", musicxml: "passed", pdf: "passed",
    worker: "not_started", network: "none", browserPlaybackAcceptance: "not_tested" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [revision, songId, epoch] = process.argv.slice(2);
  try {
    // Startup is bounded; endpoint/export failures after startup are never silently retried.
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        const ready = await fetch("http://127.0.0.1:3000/api/health/live", { signal: AbortSignal.timeout(1000) });
        if (ready.ok) break;
      } catch {}
      if (Date.now() >= deadline) throw new Error("startup deadline");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    console.log(JSON.stringify(await verifyRestoredApp(revision, songId, Number(epoch))));
  } catch {
    console.error("restored app endpoint verification failed");
    process.exitCode = 1;
  }
}
