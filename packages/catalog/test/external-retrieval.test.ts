import { describe, expect, it } from "vitest";
import { writeMidi, type Note } from "@keyspilli/midi";
import {
  classifyExternalRetrieval,
  retrieveExternalSource,
  serializeExternalRetrieval,
  toExternalResearchDiscoveryRecord,
  type ExternalRetrievalInput,
} from "../src/external-retrieval.js";
import { runSevenSongEvidence } from "../scripts/research-seven-song-evidence.js";

function midiBytes(): Uint8Array {
  const notes: Note[] = [{ midi: 60, start: 0, dur: 1, vel: 96, hand: "R" }];
  return writeMidi(notes, { tempoBpm: 120, title: "Retrieval fixture" });
}

function storedMxlBytes(): Uint8Array {
  const encoder = new TextEncoder();
  const entries = [
    ["META-INF/container.xml", "<container/>"],
    ["score.musicxml", "<score-partwise/>"],
  ] as const;
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (target: Uint8Array, at: number, value: number) => {
    target[at] = value & 0xff;
    target[at + 1] = (value >>> 8) & 0xff;
  };
  const u32 = (target: Uint8Array, at: number, value: number) => {
    target[at] = value & 0xff;
    target[at + 1] = (value >>> 8) & 0xff;
    target[at + 2] = (value >>> 16) & 0xff;
    target[at + 3] = (value >>> 24) & 0xff;
  };
  for (const [name, body] of entries) {
    const nameBytes = encoder.encode(name);
    const bodyBytes = encoder.encode(body);
    const local = new Uint8Array(30 + nameBytes.length + bodyBytes.length);
    u32(local, 0, 0x04034b50);
    u16(local, 4, 20);
    u16(local, 8, 0);
    u16(local, 18, bodyBytes.length);
    u16(local, 20, bodyBytes.length);
    u16(local, 26, nameBytes.length);
    local.set(nameBytes, 30);
    local.set(bodyBytes, 30 + nameBytes.length);
    chunks.push(local);

    const directory = new Uint8Array(46 + nameBytes.length);
    u32(directory, 0, 0x02014b50);
    u16(directory, 4, 20);
    u16(directory, 6, 20);
    u16(directory, 10, 0);
    u16(directory, 28, nameBytes.length);
    u32(directory, 20, bodyBytes.length);
    u32(directory, 24, bodyBytes.length);
    u32(directory, 42, offset);
    directory.set(nameBytes, 46);
    central.push(directory);
    offset += local.length;
  }
  const centralOffset = offset;
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  u32(end, 0, 0x06054b50);
  u16(end, 8, entries.length);
  u16(end, 10, entries.length);
  u32(end, 12, centralSize);
  u32(end, 16, centralOffset);
  const output = new Uint8Array(chunks.reduce((sum, item) => sum + item.length, 0) + centralSize + end.length);
  let cursor = 0;
  for (const chunk of [...chunks, ...central, end]) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

const page = (overrides: Partial<ExternalRetrievalInput> = {}): ExternalRetrievalInput => ({
  initialUrl: "https://provider.example/download/song.mid",
  status: 200,
  headers: { "content-type": "application/octet-stream" },
  ...overrides,
});

describe("external retrieval classification", () => {
  it("accepts valid MIDI magic even when the MIME type is generic", () => {
    const result = classifyExternalRetrieval(page({
      bytes: midiBytes(),
      headers: { "content-type": "text/plain", "content-length": String(midiBytes().byteLength) },
    }));

    expect(result.status).toBe("FOUND_ACCESSIBLE_SYMBOLIC");
    expect(result.format).toBe("midi");
    expect(result.parserEligible).toBe(true);
    expect(result.diagnostics).toMatchObject({
      initialUrl: "https://provider.example/download/song.mid",
      finalUrl: "https://provider.example/download/song.mid",
      contentType: "text/plain",
      magic: "MThd",
      authRequired: false,
    });
    expect(result.reasons.join(" ")).toMatch(/MIDI|magic|content type/i);
  });

  it("rejects HTML that masquerades as a MIDI download before any parser call", () => {
    const result = classifyExternalRetrieval(page({
      bytes: new TextEncoder().encode("<!doctype html><html><body>Download song</body></html>"),
      finalUrl: "https://provider.example/view/song.mid",
      headers: { "content-type": "application/octet-stream" },
    }));

    expect(result.status).toBe("FOUND_METADATA_ONLY");
    expect(result.format).toBe("midi");
    expect(result.parserEligible).toBe(false);
    expect(result.diagnostics.magic).toBe("html");
    expect(result.reasons.join(" ")).toMatch(/HTML|symbolic|parser/i);
  });

  it("records redirect diagnostics and accepts the final symbolic payload", () => {
    const result = classifyExternalRetrieval(page({
      redirects: [
        { url: "https://provider.example/redirect/song.mid", status: 302 },
        "https://cdn.example/assets/song.mid",
      ],
      finalUrl: "https://cdn.example/assets/song.mid",
      bytes: midiBytes(),
      headers: { "content-type": "audio/midi" },
    }));

    expect(result.status).toBe("FOUND_ACCESSIBLE_SYMBOLIC");
    expect(result.diagnostics.redirects).toEqual([
      "https://provider.example/redirect/song.mid",
      "https://cdn.example/assets/song.mid",
    ]);
    expect(result.diagnostics.finalUrl).toBe("https://cdn.example/assets/song.mid");
  });

  it("accepts response-shaped redirect/auth diagnostics and fails closed on ok=false", () => {
    const redirect = classifyExternalRetrieval({
      initialUrl: "https://provider.example/start.mid",
      response: {
        status: 200,
        ok: false,
        url: "https://provider.example/login?return=/song.mid",
        redirects: [{ location: "/login?return=/song.mid", status: 302 }],
        authRequired: true,
        bytes: midiBytes(),
      },
    });

    expect(redirect.status).toBe("FOUND_METADATA_ONLY");
    expect(redirect.parserEligible).toBe(false);
    expect(redirect.diagnostics.authRequired).toBe(true);
    expect(redirect.diagnostics.redirects).toEqual(["https://provider.example/login"]);
    expect(redirect.diagnostics.finalUrl).toBe("https://provider.example/login");
  });

  it("classifies login and paywall HTML as metadata-only and marks auth required", () => {
    const result = classifyExternalRetrieval(page({
      finalUrl: "https://provider.example/login?return=/song.mid",
      status: 200,
      headers: { "content-type": "text/html", "content-length": "84" },
      bytes: new TextEncoder().encode("<html><body>Please sign in to download. Premium subscription required.</body></html>"),
    }));

    expect(result.status).toBe("FOUND_METADATA_ONLY");
    expect(result.diagnostics.authRequired).toBe(true);
    expect(result.metadataOnly).toBe(true);
    expect(result.parserEligible).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/login|auth|paywall|subscription/i);
  });

  it("reports 404 and empty responses without handing either to a parser", () => {
    const notFound = classifyExternalRetrieval(page({ status: 404, bytes: new TextEncoder().encode("<html>Not found</html>") }));
    const empty = classifyExternalRetrieval(page({ status: 200, bytes: new Uint8Array() }));

    expect(notFound.status).toBe("NO_EXTERNAL_SOURCE");
    expect(notFound.parserEligible).toBe(false);
    expect(empty.status).toBe("FOUND_METADATA_ONLY");
    expect(empty.diagnostics.magic).toBe("empty");
    expect(empty.parserEligible).toBe(false);
  });

  it("accepts valid MusicXML by content while rejecting XML/HTML MIME confusion", () => {
    const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list></part-list><part id="P1"></part></score-partwise>`;
    const result = classifyExternalRetrieval(page({
      initialUrl: "https://provider.example/scores/song.xml",
      bytes: new TextEncoder().encode(xml),
      headers: { "content-type": "text/plain" },
    }));

    expect(result.status).toBe("FOUND_ACCESSIBLE_SYMBOLIC");
    expect(result.format).toBe("musicxml");
    expect(result.diagnostics.magic).toBe("score-partwise");
    expect(result.parserEligible).toBe(true);
  });

  it("fails closed when a symbolic MIME claims bytes that have no valid header", () => {
    const result = classifyExternalRetrieval(page({
      initialUrl: "https://provider.example/download/song.mid",
      bytes: new TextEncoder().encode("this is not midi"),
      headers: { "content-type": "audio/midi" },
    }));

    expect(result.status).toBe("FOUND_METADATA_ONLY");
    expect(result.format).toBe("midi");
    expect(result.diagnostics.magic).toBe("unknown");
    expect(result.parserEligible).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/invalid|magic|header/i);
  });

  it("requires a structurally valid MXL container instead of trusting a ZIP prefix", () => {
    const valid = classifyExternalRetrieval(page({
      initialUrl: "https://provider.example/download/song.mxl",
      bytes: storedMxlBytes(),
      headers: { "content-type": "application/vnd.recordare.musicxml" },
    }));
    expect(valid.status).toBe("FOUND_ACCESSIBLE_SYMBOLIC");
    expect(valid.format).toBe("mxl");
    expect(valid.diagnostics.magicKind).toBe("mxl");
    expect(valid.parserEligible).toBe(true);

    const fakeZip = classifyExternalRetrieval(page({
      initialUrl: "https://provider.example/download/song.mxl",
      bytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
      headers: { "content-type": "application/vnd.recordare.musicxml" },
    }));
    expect(fakeZip.status).toBe("FOUND_METADATA_ONLY");
    expect(fakeZip.diagnostics.magicKind).toBe("unknown");
    expect(fakeZip.parserEligible).toBe(false);
  });

  it("does not make a valid MIDI parser-eligible when retrieval reports an error", () => {
    const result = classifyExternalRetrieval(page({
      bytes: midiBytes(),
      error: "response was truncated after a transport warning",
    }));
    expect(result.status).toBe("FOUND_METADATA_ONLY");
    expect(result.format).toBe("midi");
    expect(result.parserEligible).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/error/i);
  });

  it("keeps piano-cover metadata separate from symbolic acquisition", () => {
    const result = classifyExternalRetrieval({
      initialUrl: "https://video.example/watch/piano-cover",
      status: 200,
      headers: { "content-type": "text/html" },
      title: "The Song - piano cover tutorial",
      bytes: new TextEncoder().encode("<html><body>Watch the performance</body></html>"),
    });

    expect(result.status).toBe("FOUND_PIANO_COVER");
    expect(result.format).toBeNull();
    expect(result.parserEligible).toBe(false);
    expect(result.metadataOnly).toBe(true);
  });

  it("labels explicit valid user evidence without changing the benchmark firewall", () => {
    const user = classifyExternalRetrieval({
      source: "user",
      userSupplied: true,
      purpose: "GENERATION_CANDIDATE",
      initialUrl: null,
      bytes: midiBytes(),
      format: "midi",
    });
    const benchmark = classifyExternalRetrieval({
      source: "user",
      userSupplied: true,
      purpose: "BENCHMARK_REFERENCE",
      initialUrl: null,
      bytes: midiBytes(),
      format: "midi",
    });

    expect(user.status).toBe("USER_EVIDENCE_AVAILABLE");
    expect(user.parserEligible).toBe(true);
    // Availability is a provenance state only; alignment and the existing
    // candidate freeze still decide whether generation may consume it.
    expect(user.generationEligible).toBe(false);
    expect(benchmark.status).not.toBe("USER_EVIDENCE_AVAILABLE");
    expect(benchmark.generationEligible).toBe(false);
    expect(benchmark.reasons.join(" ")).toMatch(/benchmark|reference|protected/i);
  });

  it("returns an explicit no-source state when no URL, metadata, or bytes are supplied", () => {
    const result = classifyExternalRetrieval({});

    expect(result.status).toBe("NO_EXTERNAL_SOURCE");
    expect(result.metadataOnly).toBe(false);
    expect(result.parserEligible).toBe(false);
  });

  it("does not perform network acquisition unless explicitly enabled", async () => {
    let calls = 0;
    const result = await retrieveExternalSource({ initialUrl: "https://provider.example/song.mid" }, {
      fetch: async () => {
        calls += 1;
        throw new Error("network should not be called");
      },
    });

    expect(calls).toBe(0);
    expect(result.status).toBe("FOUND_METADATA_ONLY");
    expect(result.parserEligible).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/network|disabled/i);
  });

  it("bounds opt-in redirects and returns the final response diagnostics", async () => {
    const calls: string[] = [];
    const result = await retrieveExternalSource({ initialUrl: "https://provider.example/start.mid" }, {
      allowNetwork: true,
      fetch: async (url) => {
        calls.push(String(url));
        if (calls.length === 1) return new Response(null, { status: 302, headers: { location: "/song.mid" } });
        return new Response(Buffer.from(midiBytes()), { status: 200, headers: { "content-type": "audio/midi" } });
      },
    });

    expect(result.status).toBe("FOUND_ACCESSIBLE_SYMBOLIC");
    expect(calls).toEqual(["https://provider.example/start.mid", "https://provider.example/song.mid"]);
    expect(result.diagnostics.redirects).toEqual(["https://provider.example/song.mid"]);
    expect(result.diagnostics.finalUrl).toBe("https://provider.example/song.mid");
  });

  it("preserves query parameters for fetching while redacting them from diagnostics", async () => {
    const calls: string[] = [];
    const result = await retrieveExternalSource({ initialUrl: "https://provider.example/song.mid?token=secret" }, {
      allowNetwork: true,
      fetch: async (url) => {
        calls.push(String(url));
        return new Response(Buffer.from(midiBytes()), { status: 200, headers: { "content-type": "audio/midi" } });
      },
    });
    expect(result.status).toBe("FOUND_ACCESSIBLE_SYMBOLIC");
    expect(calls).toEqual(["https://provider.example/song.mid?token=secret"]);
    expect(result.diagnostics.initialUrl).toBe("https://provider.example/song.mid");
    expect(JSON.stringify(result)).not.toContain("token");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("preserves signed redirect queries for the request while redacting them from diagnostics", async () => {
    const calls: string[] = [];
    const result = await retrieveExternalSource({ initialUrl: "https://provider.example/start.mid?token=initial-secret" }, {
      allowNetwork: true,
      fetch: async (url) => {
        calls.push(String(url));
        if (calls.length === 1) return new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example/song.mid?signature=redirect-secret" },
        });
        return new Response(Buffer.from(midiBytes()), { status: 200, headers: { "content-type": "audio/midi" } });
      },
    });

    expect(result.status).toBe("FOUND_ACCESSIBLE_SYMBOLIC");
    expect(calls).toEqual([
      "https://provider.example/start.mid?token=initial-secret",
      "https://cdn.example/song.mid?signature=redirect-secret",
    ]);
    expect(result.diagnostics).toMatchObject({
      initialUrl: "https://provider.example/start.mid",
      redirects: ["https://cdn.example/song.mid"],
      finalUrl: "https://cdn.example/song.mid",
    });
    expect(JSON.stringify(result)).not.toMatch(/initial-secret|redirect-secret|signature|token/);
  });

  it("serializes diagnostics deterministically without binary data or credentials", () => {
    const result = classifyExternalRetrieval(page({
      initialUrl: "https://provider.example/song.mid?token=secret",
      finalUrl: "https://cdn.example/song.mid?signature=secret",
      bytes: midiBytes(),
      redirects: ["https://provider.example/login?password=secret"],
    }));
    const json = serializeExternalRetrieval(result);

    expect(json).toContain("FOUND_ACCESSIBLE_SYMBOLIC");
    expect(json).toContain("https://provider.example/song.mid");
    expect(json).not.toContain("secret");
    expect(json).toContain('"magic": "MThd"');
    expect(json).not.toContain('"bytes"');
    expect(json).not.toContain("Uint8Array");
  });

  it("redacts credential-bearing URLs in retrieval errors and logical refs", () => {
    const result = classifyExternalRetrieval(page({
      sourceRef: "https://provider.example/song.mid?token=secret",
      error: "failed https://user:secret@provider.example/song.mid?token=secret",
    }));

    expect(result.sourceRef).toBe("https://provider.example/song.mid");
    expect(result.reasons.join(" ")).not.toContain("secret");
  });

  it("redacts spaced and arbitrary physical locators from retrieval diagnostics", () => {
    const result = classifyExternalRetrieval(page({
      error: "failed file:///private/My Folder/private artifact and /unknown-root/My Folder/private artifact",
    }));

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("My Folder");
    expect(serialized).not.toContain("private artifact");
    expect(serialized).not.toContain("/unknown-root/");
  });

  it("keeps benchmark protection when adapting retrieval metadata to discovery", () => {
    const protectedResult = classifyExternalRetrieval(page({
      benchmarkReference: true,
      bytes: midiBytes(),
    }));
    const record = toExternalResearchDiscoveryRecord(protectedResult, {
      id: "reference",
      initialUrl: "https://provider.example/song.mid",
    });

    expect(protectedResult.benchmarkProtected).toBe(true);
    expect(record).toMatchObject({
      purpose: "BENCHMARK_REFERENCE",
      evidenceClass: "BENCHMARK_REFERENCE",
    });
    expect(record.metadata).toMatchObject({ benchmarkProtected: true });
  });

  it("fails closed when evaluation-only markers have malformed runtime types", () => {
    const result = classifyExternalRetrieval(page({
      bytes: midiBytes(),
      benchmarkReference: "false" as never,
      evaluationOnly: 0 as never,
    }));

    expect(result.benchmarkProtected).toBe(true);
    expect(result.parserEligible).toBe(false);
    expect(result.status).toBe("FOUND_METADATA_ONLY");
  });

  it("does not silently discard malformed redirect acquisition metadata", () => {
    const result = classifyExternalRetrieval(page({
      bytes: midiBytes(),
      redirects: [{ url: 42 } as never],
    }));

    expect(result.parserEligible).toBe(false);
    expect(result.status).toBe("FOUND_METADATA_ONLY");
    expect(result.reasons.join(" ")).toMatch(/redirect|malformed|invalid/i);
  });

  it("drops query-bearing opaque source references instead of persisting them", () => {
    const result = classifyExternalRetrieval(page({ sourceRef: "provider:catalog/song?token=secret" }));
    expect(result.sourceRef).toBeNull();
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("keeps the seven-song inventory metadata-only by default", async () => {
    const report = await runSevenSongEvidence({ songs: [
      {
        id: "song-a",
        title: "Song A",
        artist: "Artist A",
        sources: [{ initialUrl: "https://provider.example/song.mid", title: "Song A MIDI" }],
      },
    ] });

    expect(report.network).toBe(false);
    expect(report.songs[0]?.sources[0]?.status).toBe("FOUND_METADATA_ONLY");
    expect(report.songs[0]?.sources[0]?.parserEligible).toBe(false);
  });
});
