import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccessError, decideAccess, getAccessRecord, listAccessRecords, requestAccess } from "./access-store";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "keyspilli-access-"));
  process.env.KEYSPILLI_DATA_DIR = dir;
});
afterEach(() => {
  delete process.env.KEYSPILLI_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("access store", () => {
  it("records a request once and keeps it pending", () => {
    const first = requestAccess({ id: "42", login: "alice", name: "Alice", message: "hi" });
    const again = requestAccess({ id: "42", login: "alice", message: "spam" });
    expect(again).toEqual(first);
    expect(first.status).toBe("pending");
    expect(listAccessRecords()).toHaveLength(1);
  });

  it("approves, declines and re-approves, recording who decided", () => {
    requestAccess({ id: "42", login: "alice" });
    expect(decideAccess("42", "approved", "1").status).toBe("approved");
    expect(getAccessRecord("42")).toMatchObject({ status: "approved", decidedBy: "1" });
    expect(decideAccess("42", "declined", "1").status).toBe("declined");
    expect(decideAccess("42", "approved", "1").status).toBe("approved");
  });

  it("does not let a declined account reopen its own request", () => {
    requestAccess({ id: "42", login: "alice" });
    decideAccess("42", "declined", "1");
    expect(requestAccess({ id: "42", login: "alice" }).status).toBe("declined");
  });

  it("bounds and sanitizes input", () => {
    const record = requestAccess({ id: "7", login: "bad login!", name: "x".repeat(500), message: "y".repeat(900) });
    expect(record.login).toBe("unknown");
    expect(record.name).toHaveLength(100);
    expect(record.message).toHaveLength(280);
    expect(() => requestAccess({ id: "abc", login: "a" })).toThrow(AccessError);
    expect(() => decideAccess("999", "approved", "1")).toThrow(AccessError);
  });

  it("refuses to overwrite a corrupt store", () => {
    mkdirSync(join(dir, "access"));
    writeFileSync(join(dir, "access", "requests.json"), "{not json");
    expect(() => requestAccess({ id: "42", login: "alice" })).toThrow();
    expect(() => listAccessRecords()).toThrow();
  });
});
