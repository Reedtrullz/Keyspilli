import type { ConsoleMessage, Page, Request } from "@playwright/test";

type Note = (label: string, kind: string, detail?: unknown) => void;
const cleanUrl = (value: string) => {
  try { const url = new URL(value); return url.protocol + "//" + url.host + url.pathname; }
  catch { return "[invalid-url]"; }
};

export function watchPlayerPage(
  page: Page,
  label: string,
  note: Note,
  onStop?: (stop: () => void) => void,
): () => void {
  let stopped = false;
  const onConsole = (message: ConsoleMessage) => {
    const type = message.type();
    if (type !== "warning" && type !== "error") return;
    const text = message.text();
    note(label, (/sampl|decod|audio|ogg|smpldsnds/i.test(text) ? "sampler-" : "console-") + type, text);
  };
  const onError = (error: Error) => note(label, "pageerror", error.message);
  const onFailed = (request: Request) => note(label, "requestfailed", cleanUrl(request.url()) + " " + request.resourceType() + " " + (request.failure()?.errorText ?? ""));
  const onCrash = () => note(label, "crash", "page crashed");
  const stop = () => {
    if (stopped) return;
    stopped = true;
    page.off("console", onConsole);
    page.off("pageerror", onError);
    page.off("requestfailed", onFailed);
    page.off("crash", onCrash);
    page.off("close", onClose);
    try { onStop?.(stop); } catch { /* cleanup must not mask a page failure */ }
  };
  const onClose = () => {
    note(label, "close");
    stop();
  };
  page.on("console", onConsole);
  page.on("pageerror", onError);
  page.on("requestfailed", onFailed);
  page.on("crash", onCrash);
  page.on("close", onClose);
  return stop;
}
