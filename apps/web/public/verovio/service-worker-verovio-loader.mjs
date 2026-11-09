const DEFAULT_EXPORT = /export default createVerovioModule;?\s*$/;

export function evaluateVerovioModuleSource(source, moduleUrl) {
  if (!DEFAULT_EXPORT.test(source)) throw new Error("Verovio module default export is missing");
  const body = source.replaceAll("import.meta.url", JSON.stringify(moduleUrl)).replace(DEFAULT_EXPORT, "return createVerovioModule;");
  return new Function(body)();
}

export async function loadServiceWorkerVerovio(fetchImpl, Toolkit, moduleUrl) {
  const response = await fetchImpl(moduleUrl);
  if (!response.ok) throw new Error(`Verovio module unavailable (${response.status})`);
  const createVerovioModule = evaluateVerovioModuleSource(await response.text(), moduleUrl);
  return new Toolkit(await createVerovioModule());
}
