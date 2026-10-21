import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyRestoredApp } from "../restore-app-verifier.mjs";

const { waitForRestoredApp } = await import("../restore-app-verifier.mjs");
const readinessCalls = [];
let readinessAttempts = 0;
await waitForRestoredApp(async (url) => {
  readinessCalls.push(url);
  return new Response("", { status: ++readinessAttempts === 1 ? 503 : 200 });
});
assert.deepEqual(readinessCalls, ["http://127.0.0.1:3000/api/health/live", "http://127.0.0.1:3000/api/health/live"]);
const nativeNow = Date.now;
let clockCalls = 0;
try {
  Date.now = () => clockCalls++ === 0 ? 0 : 30_000;
  await assert.rejects(waitForRestoredApp(async () => new Response("", { status: 503 })), /startup deadline/);
} finally {
  Date.now = nativeNow;
}
const readyOnly = spawnSync(process.execPath, ["--import", "data:text/javascript," + encodeURIComponent(`
  globalThis.fetch = async url => {
    if (url !== "http://127.0.0.1:3000/api/health/live") throw new Error("Readiness entered full verification");
    return new Response("");
  };
`), fileURLToPath(new URL("../restore-app-verifier.mjs", import.meta.url)), "a".repeat(40), "restored-easy", "1", "--ready-only"],
{ encoding: "utf8", timeout: 5000 });
assert.equal(readyOnly.status, 0, readyOnly.stderr);
assert.deepEqual(JSON.parse(readyOnly.stdout), { startupReadiness: "passed" });

const revision = "a".repeat(40);
const calls = [];
const midi = Buffer.from("4d546864000000060000000101e04d54726b0000000d00903c408360803c0000ff2f00", "hex");
const xml = '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure></part></score-partwise>';
// A complete, one-page PDF with real object offsets and a cross-reference table.
let pdf = "%PDF-1.4\n";
const offsets = [];
for (const object of ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>"]) {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${offsets.length} 0 obj\n${object}\nendobj\n`;
}
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 4\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const fixture = async (url) => {
  const { pathname, searchParams } = new URL(url);
  calls.push(url);
  let body = "<html></html>";
  if (pathname === "/api/health") body = JSON.stringify({ status: "healthy", version: revision, readiness: { catalog: { schemaEpoch: 1 } } });
  else if (pathname === "/api/songs/restored-easy") body = JSON.stringify({ song: { id: "restored-easy" }, data: { notes: [{ midi: 60 }] } });
  else if (searchParams.get("type") === "midi") body = midi;
  else if (searchParams.get("type") === "musicxml") body = xml;
  else if (searchParams.get("type") === "pdf") body = pdf;
  return new Response(body);
};
process.env.KEYSPILLI_API_TOKEN = "restore-test-token";
const sentHeaders = [];
assert.equal((await verifyRestoredApp(revision, "restored-easy", 1, async (url, init) => {
  sentHeaders.push(init?.headers?.["x-keyspilli-api-token"]);
  return fixture(url);
})).pdf, "passed");
assert.equal(sentHeaders.length, 7);
assert(sentHeaders.every((value) => value === "Bearer restore-test-token"));
assert(calls.every((url) => url.startsWith("http://127.0.0.1:3000/")));
assert.equal(calls.length, 7);
await assert.rejects(verifyRestoredApp("b".repeat(40), "restored-easy", 1, fixture), /identity/);
await assert.rejects(verifyRestoredApp(revision, "restored-easy", 2, fixture), /schema/);
await assert.rejects(verifyRestoredApp(revision, "restored-easy", 1, async (url) =>
  url.includes("type=midi") ? new Response("corrupt") : fixture(url)), /symbolic/);
await assert.rejects(verifyRestoredApp(revision, "restored-easy", 1, async (url) =>
  url.includes("type=pdf") ? new Response("unavailable", { status: 503 }) : fixture(url)), /endpoint/);
// Export signatures alone must not certify truncated backup artifacts.
for (const [type, body, error] of [
  ["midi", "MThd fixture", /symbolic/],
  ["midi", midi.subarray(0, -1), /symbolic/],
  ["musicxml", '<score-partwise version="4.0">', /symbolic/],
  ["musicxml", xml.replace("</score-partwise>", ""), /symbolic/],
  ["musicxml", xml.replace("</score-partwise>", "</score-timewise>"), /symbolic/],
  ["pdf", "%PDF-1.7 fixture", /PDF/],
  ["pdf", pdf.slice(0, -10), /PDF/],
]) {
  await assert.rejects(verifyRestoredApp(revision, "restored-easy", 1, async (url) =>
    new URL(url).searchParams.get("type") === type ? new Response(body) : fixture(url)), error);
}
console.log("restore application verifier fixtures passed (no container or real restore executed)");
