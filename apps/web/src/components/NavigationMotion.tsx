"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

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
      documentWithTransition.startViewTransition(() => {
        router.push(`${url.pathname}${url.search}${url.hash}`);
      });
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  return null;
}
