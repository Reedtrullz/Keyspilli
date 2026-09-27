"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => unknown;
};

/**
 * Let supported browsers keep the outgoing route visible while the App Router
 * swaps in the next page. Unsupported browsers keep normal Link behavior.
 * Modifier clicks, downloads, API links, and explicitly opted-out links are
 * deliberately left alone so navigation semantics stay familiar.
 */
export function NavigationMotion() {
  const router = useRouter();
  const pathname = usePathname();
  const settleNavigation = useRef<(() => void) | null>(null);

  // The new route has committed to the DOM; let the browser snapshot it.
  useEffect(() => {
    settleNavigation.current?.();
    settleNavigation.current = null;
  }, [pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as Element | null;
      const link = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download") || link.dataset.noViewTransition !== undefined) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;

      const documentWithTransition = document as ViewTransitionDocument;
      if (typeof documentWithTransition.startViewTransition !== "function") return;
      event.preventDefault();
      documentWithTransition.startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            // router.push() returns before the next page renders. Resolving
            // only once the pathname commits keeps the browser from capturing
            // the old page as the "new" snapshot and then popping the real page
            // in after the animation. Same-path navigations and slow routes
            // fall back to a short cap so the page never stays frozen.
            const done = () => {
              clearTimeout(timeout);
              resolve();
            };
            const timeout = setTimeout(done, url.pathname === window.location.pathname ? 0 : 1500);
            settleNavigation.current = done;
            router.push(`${url.pathname}${url.search}${url.hash}`);
          }),
      );
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  return null;
}
