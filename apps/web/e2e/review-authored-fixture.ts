import { expect, type Page } from "@playwright/test";

export async function reviewAuthoredFixture(page: Page) {
  await page.getByRole("button", { name: "Review file parts", exact: true }).click();
  const parts = page.getByRole("list", { name: "Source parts" });
  await expect(parts.getByRole("checkbox").first()).toBeVisible();
  for (const checkbox of await parts.getByRole("checkbox").all()) await checkbox.check();
  for (const role of await parts.getByRole("combobox").all()) await role.selectOption("other");
  await page.getByRole("checkbox", { name: /I created these symbolic bytes/ }).check();
}
