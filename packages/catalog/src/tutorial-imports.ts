/** Runtime opt-in for the private tutorial beta; legacy preview remains development-only. */
export function tutorialImportsEnabled(): boolean {
  return Boolean(process.env.KEYSPILLI_DATA_DIR?.trim()) && (
    (process.env.KEYSPILLI_TUTORIAL_BETA === "1" && ["production", "development"].includes(process.env.NODE_ENV ?? "")) ||
    (process.env.KEYSPILLI_TUTORIAL_PREVIEW === "1" && process.env.NODE_ENV === "development")
  );
}
