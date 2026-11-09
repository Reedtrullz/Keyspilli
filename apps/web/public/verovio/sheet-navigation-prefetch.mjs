export const SHEET_NAVIGATION_PREFETCH_TTL_MS = 30_000;

export function normalizeSheetNavigationUrl(value, origin) {
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.search || url.hash || !/^\/player\/[^/]+\/sheet$/.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function takeFreshNavigationPrefetch(entry, url, now = Date.now()) {
  if (!entry || entry.url !== url || entry.expiresAt <= now) return null;
  return entry.response.clone();
}
