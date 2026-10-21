import { getAccessRecord, type AccessStatus } from "./access-store";

export interface AuthzUser {
  id?: string | number | null;
}

export type AccessRole = "owner" | "tester" | "pending" | "declined" | "none" | "anonymous";
export type AccessLookup = (id: string) => AccessStatus | undefined;

export type AuthzEnv = Record<string, string | undefined>;

/** Numeric GitHub account ids (stable across renames) from the deploy settings. */
function idList(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((id) => id.trim()).filter(Boolean));
}

/** A corrupt or missing store grants nothing; the owner and deploy-configured testers still work. */
const storedStatus: AccessLookup = (id) => {
  try {
    return getAccessRecord(id)?.status;
  } catch {
    return undefined;
  }
};

/** Owner and deploy-configured testers first, then testers the owner approved in the app. */
export function accessRole(user: AuthzUser | null | undefined, env: AuthzEnv = process.env, lookup: AccessLookup = storedStatus): AccessRole {
  const id = user?.id === undefined || user.id === null ? "" : String(user.id);
  if (!id) return "anonymous";
  if (idList(env.OWNER_GITHUB_ID).has(id)) return "owner";
  if (idList(env.TESTER_GITHUB_IDS).has(id)) return "tester";
  const status = lookup(id);
  return status === "approved" ? "tester" : status ?? "none";
}

export function hasAccess(role: AccessRole): boolean {
  return role === "owner" || role === "tester";
}

/** An unset or empty allowlist admits nobody. */
export function isAllowedUser(user: AuthzUser | null | undefined, env: AuthzEnv = process.env, lookup?: AccessLookup): boolean {
  return hasAccess(accessRole(user, env, lookup));
}

export type GateDecision = "allow" | "signin" | "profile" | "forbidden";

/** Signed-in accounts without access may only see their profile, where they can apply. */
export function gateDecision(role: AccessRole, pathname: string): GateDecision {
  if (hasAccess(role)) return "allow";
  if (role === "anonymous") return "signin";
  if (pathname === "/profile") return "allow";
  return pathname.startsWith("/api/") ? "forbidden" : "profile";
}

/** Only same-site paths may be used as a post-login destination. */
export function safeCallbackPath(value: unknown): string {
  return typeof value === "string" && /^\/(?![/\\])/.test(value) ? value : "/";
}
