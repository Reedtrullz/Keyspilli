export async function prefetchSheetNavigation(songId: string): Promise<void> {
  const container = navigator.serviceWorker;
  if (!container) return;
  try {
    const registration = await container.ready;
    registration.active?.postMessage({
      type: "prefetch-sheet-navigation",
      url: new URL(`/player/${encodeURIComponent(songId)}/sheet`, location.origin).href,
    });
  } catch {
    // The normal navigation path remains available when prefetching is unavailable.
  }
}
