import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalPdfSha256, copyBoundedEvidence } from "../t17-evidence.mjs";

function sha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function pdf({ date = "D:20261108172432+00'00'", id = "<aabb> <ccdd>", xmpDate = "2026-11-08T17:24:32Z", content = "q 1 0 0 1 0 0 cm Q" } = {}) {
  const xmp = `<x:xmpmeta><rdf:Description><xmp:CreateDate>${xmpDate}</xmp:CreateDate><xmpMM:DocumentID>uuid:${xmpDate}</xmpMM:DocumentID></rdf:Description></x:xmpmeta>`;
  return Buffer.from([
    "%PDF-1.4",
    "1 0 obj",
    `<</Producer (Skia/PDF m153) /CreationDate (${date}) /ModDate (${date})>>`,
    "endobj",
    "2 0 obj",
    `<</Type /Metadata /Subtype /XML /Length ${xmp.length}>>stream`,
    xmp,
    "endstream",
    "endobj",
    "3 0 obj",
    `<</Length ${content.length}>>stream`,
    content,
    "endstream",
    "endobj",
    "trailer",
    `<</ID [${id}]>>`,
    "%%EOF",
    "",
  ].join("\n"));
}

test("canonical PDF fingerprint ignores only Chrome's volatile metadata", () => {
  const first = pdf();
  const second = pdf({ date: "D:20261108182500+00'00'", id: "<1122> <3344>", xmpDate: "2026-11-08T18:25:00Z" });
  assert.notEqual(sha(first), sha(second));
  assert.equal(canonicalPdfSha256(first), canonicalPdfSha256(second));
  assert.notEqual(canonicalPdfSha256(first), canonicalPdfSha256(pdf({ content: "q 2 0 0 2 0 0 cm Q" })));
  assert.throws(() => canonicalPdfSha256(Buffer.from("not a pdf")), /malformed PDF/);
});

test("bounded package copies only receipt, attachment and trace", () => {
  const root = mkdtempSync(join(tmpdir(), "keyspilli-t17-evidence-"));
  try {
    const scratch = join(root, "scratch");
    mkdirSync(join(scratch, "playwright"), { recursive: true });
    mkdirSync(join(scratch, "node"), { recursive: true });
    const attachment = join(scratch, "playwright", "performance-stress.json");
    const trace = join(scratch, "playwright", "t17-sizing.trace.zip");
    writeFileSync(join(scratch, "receipt.json"), "{\"status\":\"complete\"}\n");
    writeFileSync(attachment, "{}\n");
    writeFileSync(trace, Buffer.alloc(16, 1));
    writeFileSync(join(scratch, "node", "cache.bin"), Buffer.alloc(16, 2));
    const keep = join(root, "keep");
    const manifest = copyBoundedEvidence({ scratch, keep, attachment, trace });
    assert.deepEqual(manifest.entries.map(entry => entry.name).sort(), ["playwright/performance-stress.json", "playwright/t17-sizing.trace.zip", "receipt.json"]);
    assert.equal(manifest.totalBytes <= 64 * 1024 * 1024, true);
    assert.equal(existsSync(join(keep, "node", "cache.bin")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bounded package omits an oversized trace and rejects an oversized required file", () => {
  const root = mkdtempSync(join(tmpdir(), "keyspilli-t17-evidence-"));
  try {
    const scratch = join(root, "scratch");
    mkdirSync(join(scratch, "playwright"), { recursive: true });
    const attachment = join(scratch, "playwright", "performance-stress.json");
    const trace = join(scratch, "playwright", "t17-sizing.trace.zip");
    writeFileSync(join(scratch, "receipt.json"), "{}\n");
    writeFileSync(attachment, "{}\n");
    writeFileSync(trace, Buffer.alloc(5, 1));
    const keep = join(root, "keep");
    const manifest = copyBoundedEvidence({ scratch, keep, attachment, trace, traceCap: 4 });
    assert.match(manifest.entries.find(entry => entry.name === "playwright/t17-sizing.trace.zip").omitted, /trace cap 4/);
    assert.equal(existsSync(join(keep, "playwright", "t17-sizing.trace.zip")), false);
    assert.throws(() => copyBoundedEvidence({ scratch: join(root, "missing"), keep: join(root, "missing-keep") }), /no receipt or failure evidence/);
    assert.throws(() => copyBoundedEvidence({ scratch, keep: join(root, "tiny"), attachment, cap: 2 }), /required evidence exceeds/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
