// Shared by every Playwright config. The app gate admits the maintainer
// bearer, so browser contexts send it instead of signing in; login.spec.ts
// covers the real sign-in flow with its own context.
export const E2E_API_TOKEN = "test-token-for-e2e";
export const E2E_AUTH_ENV = {
  AUTH_SECRET: "e2e-only-secret-not-for-production",
  OWNER_GITHUB_ID: "1",
};
export const E2E_AUTH_HEADERS = { "x-keyspilli-api-token": `Bearer ${E2E_API_TOKEN}` };
