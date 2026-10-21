import { describe, expect, it } from "vitest";
import { isAllowedUser, safeCallbackPath } from "./authz";

const env = { OWNER_GITHUB_ID: "100", TESTER_GITHUB_IDS: " 200, 300 ," };

describe("isAllowedUser", () => {
  it("admits the owner and listed testers by id", () => {
    expect(isAllowedUser({ id: "100" }, env)).toBe(true);
    expect(isAllowedUser({ id: 200 }, env)).toBe(true);
    expect(isAllowedUser({ id: "300" }, env)).toBe(true);
  });

  it("rejects strangers, missing ids and an empty allowlist", () => {
    expect(isAllowedUser({ id: "999" }, env)).toBe(false);
    expect(isAllowedUser({}, env)).toBe(false);
    expect(isAllowedUser(null, env)).toBe(false);
    expect(isAllowedUser({ id: "" }, {})).toBe(false);
    expect(isAllowedUser({ id: "100" }, {})).toBe(false);
  });
});

describe("safeCallbackPath", () => {
  it("keeps same-site paths and rejects everything else", () => {
    expect(safeCallbackPath("/songs?x=1")).toBe("/songs?x=1");
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "songs", undefined, 5]) {
      expect(safeCallbackPath(bad)).toBe("/");
    }
  });
});
