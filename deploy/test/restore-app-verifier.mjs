import assert from "node:assert/strict";
import { verifyRestoredApp } from "../restore-app-verifier.mjs";

const revision = "a".repeat(40);
const calls = [];
const fixture = async (url) => {
  const { pathname, searchParams } = new URL(url);
  calls.push(url);
  let body = "<html></html>";
  if (pathname === "/api/health") body = JSON.stringify({ status: "healthy", version: revision, readiness: { catalog: { schemaEpoch: 1 } } });
  else if (pathname === "/api/songs/restored-easy") body = JSON.stringify({ song: { id: "restored-easy" }, data: { notes: [{ midi: 60 }] } });
  else if (searchParams.get("type") === "midi") body = "MThd fixture";
  else if (searchParams.get("type") === "musicxml") body = '<score-partwise version="4.0"></score-partwise>';
  else if (searchParams.get("type") === "pdf") body = "%PDF-1.7 fixture";
  return new Response(body);
};
assert.equal((await verifyRestoredApp(revision, "restored-easy", 1, fixture)).pdf, "passed");
assert(calls.every((url) => url.startsWith("http://127.0.0.1:3000/")));
assert.equal(calls.length, 7);
await assert.rejects(verifyRestoredApp("b".repeat(40), "restored-easy", 1, fixture), /identity/);
await assert.rejects(verifyRestoredApp(revision, "restored-easy", 2, fixture), /schema/);
await assert.rejects(verifyRestoredApp(revision, "restored-easy", 1, async (url) =>
  url.includes("type=midi") ? new Response("corrupt") : fixture(url)), /symbolic/);
await assert.rejects(verifyRestoredApp(revision, "restored-easy", 1, async (url) =>
  url.includes("type=pdf") ? new Response("unavailable", { status: 503 }) : fixture(url)), /endpoint/);
console.log("restore application verifier fixtures passed (no container or real restore executed)");
