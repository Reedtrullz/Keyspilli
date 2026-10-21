import { describe, expect, it } from "vitest";
import { accessRole, gateDecision, isAllowedUser, safeCallbackPath } from "./authz";

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

describe("accessRole", () => {
  const approved = (id: string) => (id === "500" ? ("approved" as const) : id === "501" ? ("pending" as const) : id === "502" ? ("declined" as const) : undefined);

  it("ranks owner, configured tester, approved tester, then the request states", () => {
    expect(accessRole({ id: "100" }, env, approved)).toBe("owner");
    expect(accessRole({ id: "200" }, env, approved)).toBe("tester");
    expect(accessRole({ id: "500" }, env, approved)).toBe("tester");
    expect(accessRole({ id: "501" }, env, approved)).toBe("pending");
    expect(accessRole({ id: "502" }, env, approved)).toBe("declined");
    expect(accessRole({ id: "999" }, env, approved)).toBe("none");
    expect(accessRole(null, env, approved)).toBe("anonymous");
  });

  it("only an approved status admits an account", () => {
    expect(isAllowedUser({ id: "500" }, env, approved)).toBe(true);
    for (const id of ["501", "502", "999"]) expect(isAllowedUser({ id }, env, approved)).toBe(false);
  });
});

describe("gateDecision", () => {
  it("sends signed-in accounts without access to the profile only", () => {
    expect(gateDecision("owner", "/admin")).toBe("allow");
    expect(gateDecision("tester", "/songs")).toBe("allow");
    expect(gateDecision("anonymous", "/songs")).toBe("signin");
    for (const role of ["none", "pending", "declined"] as const) {
      expect(gateDecision(role, "/profile")).toBe("allow");
      expect(gateDecision(role, "/songs")).toBe("profile");
      expect(gateDecision(role, "/admin")).toBe("profile");
      expect(gateDecision(role, "/api/songs")).toBe("forbidden");
    }
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
