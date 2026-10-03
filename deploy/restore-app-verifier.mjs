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
  if (midi.length < 14 || midi.subarray(0, 4).toString() !== "MThd" || midi.readUInt32BE(4) !== 6) {
    throw new Error("restored symbolic export invalid");
  }
  const tracks = midi.readUInt16BE(10);
  let end = 14;
  if (!tracks || tracks > 512) throw new Error("restored symbolic export invalid");
  for (let track = 0; track < tracks; track++) {
    if (end + 8 > midi.length || midi.subarray(end, end + 4).toString() !== "MTrk") {
      throw new Error("restored symbolic export invalid");
    }
    end += 8 + midi.readUInt32BE(end + 4);
    if (end > midi.length) throw new Error("restored symbolic export invalid");
  }
  const score = xml.toString();
  if (end !== midi.length || !/<score-(partwise|timewise)\b[\s\S]*<\/score-\1>\s*$/.test(score)
      || !/<note\b/.test(score)) {
    throw new Error("restored symbolic export invalid");
  }
  for (const layout of ["simplify", "classic"]) {
    const pdf = await get(`/api/song/${songId}/export?type=pdf&layout=${layout}`, 32 * 1024 * 1024, 95_000);
    const trailer = pdf.subarray(-1024).toString().match(/startxref\s+(\d+)\s+%%EOF\s*$/);
    if (pdf.subarray(0, 5).toString() !== "%PDF-" || !trailer || Number(trailer[1]) >= pdf.length) {
      throw new Error("restored PDF invalid");
    }
  }
  // ponytail: framing checks catch incomplete exports; semantic playback/rendering needs separate acceptance.
  return { health: "passed", playerDocument: "passed", midi: "passed", musicxml: "passed", pdf: "passed",
    exportValidation: "framing_only", worker: "not_started", network: "none", browserPlaybackAcceptance: "not_tested" };
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
