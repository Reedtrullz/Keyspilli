"use client";

import { useLinkStatus } from "next/link";
import { useEffect } from "react";

/** Keep Next Link's pending/cancellation semantics, including keyboard activation. */
export function NavigationFeedback({ destination }: { destination: string }) {
  const { pending } = useLinkStatus();
  useEffect(() => {
    if (!pending) return;
    window.dispatchEvent(new CustomEvent("keyspilli:navigation", { detail: true }));
    return () => { window.dispatchEvent(new CustomEvent("keyspilli:navigation", { detail: false })); };
  }, [pending]);
  return pending ? <span role="status" className="ml-2 text-xs">Opening {destination}…</span> : null;
}
