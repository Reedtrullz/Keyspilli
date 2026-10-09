import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const root = resolve(process.env.KEYSPILLI_SCORE_REVIEW_REPORT!);
let server: Server, url: string;
test.beforeAll(async () => {
    server = createServer(async (req, res) => {
        try {
            const name = new URL(req.url!, "http://localhost").pathname.slice(1) || "index.html";
            if (!/^[\w.-]+$/.test(name))
                throw Error("unsafe path");
            const b = await readFile(join(root, name));
            res.setHeader("Content-Type", name.endsWith(".html") ? "text/html" : "application/json");
            res.end(b);
        }
        catch {
            res.statusCode = 404;
            res.end();
        }
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const address = server.address();
    if (!address || typeof address === "string")
        throw Error("missing address");
    url = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((r, e) => server.close(err => err ? e(err) : r())); });
for (const width of [1280, 390])
    test(`results and evidence links at ${width}px`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", e => errors.push(e.message));
        await page.setViewportSize({ width, height: 900 });
        await page.goto(url);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.locator("textarea,input,button")).toHaveCount(0);
        await expect(page.getByText("Production admission: false.", { exact: false })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const links = await page.getByRole("link").evaluateAll(elements => elements.map(e => (e as HTMLAnchorElement).href));
        for (const link of links)
            expect((await page.request.get(link)).ok()).toBe(true);
        await page.keyboard.press("Tab");
        expect(await page.locator(":focus").getAttribute("href")).toBeTruthy();
        expect(errors).toEqual([]);
        await page.screenshot({ path: join(root, `browser-${width}.png`), fullPage: true });
        await writeFile(join(root, `browser-${width}.json`), JSON.stringify({ width, errors, links: links.length, overflow: false, controls: 0, providerCalls: 0 }), { flag: "wx" });
    });
