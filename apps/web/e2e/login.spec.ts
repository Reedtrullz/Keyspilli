import { expect, test } from "@playwright/test";

// No bearer header here: these cases exercise the real session gate.
test.use({ extraHTTPHeaders: {} });

async function signIn(request: import("@playwright/test").APIRequestContext, token: string) {
  const { csrfToken } = await (await request.get("/api/auth/csrf")).json();
  return request.post("/api/auth/callback/e2e-owner", {
    form: { csrfToken, token },
    maxRedirects: 0,
  });
}

test("anonymous pages go to sign-in and APIs answer 401", async ({ page, request }) => {
  await page.goto("/songs");
  await expect(page).toHaveURL(/\/signin\?callbackUrl=%2Fsongs/);
  await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
  expect((await request.get("/api/songs")).status()).toBe(401);
  expect((await request.get("/api/health")).status()).toBe(401);
  expect((await request.get("/api/songs", { headers: { "x-keyspilli-api-token": "Bearer wrong" } })).status()).toBe(401);
  expect((await request.get("/api/health/live")).status()).not.toBe(401);
});

test("an allowlisted session reaches the app, signs out, and a bad login is refused", async ({ page }) => {
  const denied = await signIn(page.request, "wrong-token");
  expect(denied.headers()["location"] ?? "").toContain("error=");
  await page.goto("/songs");
  await expect(page).toHaveURL(/\/signin/);

  await signIn(page.request, "e2e-login-token");
  await page.goto("/songs");
  await expect(page).toHaveURL(/\/songs$/);
  expect((await page.request.get("/api/songs")).status()).toBe(200);

  await page.getByRole("button", { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/signin/);
  await page.goto("/songs");
  await expect(page).toHaveURL(/\/signin/);
});
