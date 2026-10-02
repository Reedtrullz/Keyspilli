export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateRuntimeConfiguration } = await import("@keyspilli/catalog/src/readiness.js");
    validateRuntimeConfiguration();
    // Normal app startup owns schema initialization; read-only preflight never does.
    if (process.env.KEYSPILLI_DATA_DIR) {
      const { getDb } = await import("@keyspilli/catalog/src/db.js");
      getDb();
    }
  }
}
