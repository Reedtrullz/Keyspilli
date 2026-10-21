export interface AuthzUser {
  id?: string | number | null;
}

export type AuthzEnv = Record<string, string | undefined>;

/** Numeric GitHub account ids (stable across renames) for the owner and invited testers. */
function allowedIds(env: AuthzEnv): Set<string> {
  const ids = [env.OWNER_GITHUB_ID, ...(env.TESTER_GITHUB_IDS ?? "").split(",")];
  return new Set(ids.map((id) => id?.trim()).filter((id): id is string => Boolean(id)));
}

/** An unset or empty allowlist admits nobody. */
export function isAllowedUser(user: AuthzUser | null | undefined, env: AuthzEnv = process.env): boolean {
  if (user?.id === undefined || user.id === null) return false;
  return allowedIds(env).has(String(user.id));
}

/** Only same-site paths may be used as a post-login destination. */
export function safeCallbackPath(value: unknown): string {
  return typeof value === "string" && /^\/(?![/\\])/.test(value) ? value : "/";
}
