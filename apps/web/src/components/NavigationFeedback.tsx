"use client";

import { useLinkStatus } from "next/link";
import { useEffect } from "react";

// Next 16 starts a fresh navigation for every activation of a pending Link,
// where Next 15 reused the in-flight one. Swallow repeat plain activations of
// the link that is already pending so one activation stays one navigation.
let lastActivatedHref: string | null = null;
let pendingHref: string | null = null;
let installed = false;

function installRepeatActivationGuard() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("click", event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (pendingHref !== null && anchor.href === pendingHref) { event.preventDefault(); return; }
    lastActivatedHref = anchor.href;
  }, true);
}

/** Keep Next Link's pending/cancellation semantics, including keyboard activation. */
export function NavigationFeedback({ destination }: { destination: string }) {
  const { pending } = useLinkStatus();
  useEffect(() => { installRepeatActivationGuard(); }, []);
  useEffect(() => {
    if (!pending) return;
    const href = lastActivatedHref;
    pendingHref = href;
    window.dispatchEvent(new CustomEvent("keyspilli:navigation", { detail: true }));
    return () => {
      if (pendingHref === href) pendingHref = null;
      window.dispatchEvent(new CustomEvent("keyspilli:navigation", { detail: false }));
    };
  }, [pending]);
  return pending ? <span role="status" className="ml-2 text-xs">Opening {destination}…</span> : null;
}
