import { request } from "@playwright/test";

/** Signs in through the loopback-only test provider and saves the session cookie for the whole run. */
export default async function globalSetup() {
  const baseURL = process.env.KEYSPILLI_E2E_BASE_URL;
  const statePath = process.env.KEYSPILLI_E2E_STORAGE_STATE;
  if (!baseURL || !statePath) throw new Error("KEYSPILLI_E2E_BASE_URL and KEYSPILLI_E2E_STORAGE_STATE are required");
  const api = await request.newContext({ baseURL });
  const { csrfToken } = await (await api.get("/api/auth/csrf")).json();
  await api.post("/api/auth/callback/e2e-owner", {
    form: { csrfToken, token: process.env.KEYSPILLI_E2E_LOGIN_TOKEN ?? "" },
    maxRedirects: 0,
  });
  const session = await (await api.get("/api/auth/session")).json();
  if (!session?.user) throw new Error("e2e login failed");
  await api.storageState({ path: statePath });
  await api.dispose();
}
