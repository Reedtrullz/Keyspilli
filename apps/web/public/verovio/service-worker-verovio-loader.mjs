const DEFAULT_EXPORT = /export default createVerovioModule;?\s*$/;
export const VEROVIO_MODULE_SHA256 = "d9b11f1aa61e9e1e97a77301eda85414d94e278ec33a5dcaa781727cca5e0f26";

export function evaluateVerovioModuleSource(source, moduleUrl) {
  if (!DEFAULT_EXPORT.test(source)) throw new Error("Verovio module default export is missing");
  const body = source.replaceAll("import.meta.url", JSON.stringify(moduleUrl)).replace(DEFAULT_EXPORT, "return createVerovioModule;");
  return new Function(body)();
}

async function sha256(source) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function loadServiceWorkerVerovio(fetchImpl, Toolkit, moduleUrl, expectedSha256 = VEROVIO_MODULE_SHA256) {
  const response = await fetchImpl(moduleUrl);
  if (!response.ok || response.redirected || response.url !== moduleUrl) throw new Error(`Verovio module unavailable (${response.status})`);
  const source = await response.text();
  if (await sha256(source) !== expectedSha256) throw new Error("Verovio module integrity check failed");
  const createVerovioModule = evaluateVerovioModuleSource(source, moduleUrl);
  return new Toolkit(await createVerovioModule());
}
