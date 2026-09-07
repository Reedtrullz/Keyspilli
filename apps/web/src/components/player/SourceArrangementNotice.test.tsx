import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { SourceArrangement } from "@keyspilli/catalog/src/source-arrangement.js";
import { SourceArrangementNotice } from "./SourceArrangementNotice";

it("distinguishes the requested recording, selected source and missing vocal melody", () => {
  const source: SourceArrangement = { beta: true, sourceKind: "verified-native-midi", arrangementTitle: "Test Piano", title: "Test", artist: "Fixture", requestedUrl: "https://youtube.com/watch?v=abcdefghijk", actualSourceUrl: "https://scores.example/song.mid", sourceSha256: "a".repeat(64), realizationSha256: "b".repeat(64), candidateSetDigest: "c".repeat(64), timingOwner: "selected-arrangement", containsMelody: false, license: "CC0-1.0", licenseEvidenceUrl: "https://scores.example/license", verificationEvidenceUrl: "https://scores.example/song" };
  const html = renderToStaticMarkup(<SourceArrangementNotice source={source} />);
  expect(html).toContain("Source-assisted beta");
  expect(html).toContain("Accompaniment only");
  expect(html).toContain(source.actualSourceUrl);
  expect(html).toContain(source.requestedUrl);
  expect(html).toContain("Timing follows this arrangement");
  expect(renderToStaticMarkup(<SourceArrangementNotice />)).toBe("");
});
