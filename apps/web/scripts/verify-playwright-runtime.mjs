import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});

try {
  const version = browser.version();
  if (!version) throw new Error("Playwright Chromium did not report a browser version");
  console.log(`Playwright Chromium smoke check passed (${version})`);
} finally {
  await browser.close();
}
