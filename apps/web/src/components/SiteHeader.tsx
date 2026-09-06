"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { usePresence } from "./player/player-motion";

const NAV = [
  ["/", "Home"],
  ["/songs", "Songs"],
  ["/artists", "Artists"],
  ["/uploads", "Add a song"],
] as const;

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const [moreOpen, setMoreOpen] = useState(false);
  const morePresence = usePresence(moreOpen);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreActive = NAV.slice(2).some(([href]) => pathname === href || pathname.startsWith(`${href}/`));

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (moreButtonRef.current?.contains(target) || moreMenuRef.current?.contains(target)) return;
      const hadFocus = moreMenuRef.current?.contains(document.activeElement) ?? false;
      setMoreOpen(false);
      if (hadFocus) window.requestAnimationFrame(() => moreButtonRef.current?.focus());
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMoreOpen(false);
      window.requestAnimationFrame(() => moreButtonRef.current?.focus());
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  useEffect(() => {
    const menu = moreMenuRef.current;
    if (!menu) return;
    if (!morePresence.visible) menu.setAttribute("inert", "");
    else menu.removeAttribute("inert");
  }, [morePresence.mounted, morePresence.visible]);

  return (
    <header className="site-header relative border-b border-zinc-200 bg-white sticky top-0 z-40">
      <div className="site-header-inner max-w-6xl mx-auto px-4 py-2 flex flex-nowrap items-center gap-x-4 gap-y-1 overflow-x-auto">
        <Link href="/" className="site-brand pressable shrink-0 font-bold text-lg tracking-tight">
          Keyspilli
        </Link>
        <nav className="site-nav flex shrink-0 gap-1 text-sm" aria-label="Main">
          {NAV.map(([href, label], index) => {
            const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`site-nav-link site-nav-secondary-${index >= 2 ? "item" : "primary"} pressable px-3 py-1.5 rounded-full`}
              >
                {label}
              </Link>
            );
          })}
          <button
            ref={moreButtonRef}
            type="button"
            className={`site-nav-more site-nav-link pressable px-3 py-1.5 rounded-full ${moreActive ? "font-semibold" : ""}`}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-controls="site-more-menu"
            data-active={moreActive ? "true" : undefined}
            onClick={() => setMoreOpen((open) => !open)}
          >
            More
          </button>
        </nav>
      </div>
      {morePresence.mounted && (
        <div
          ref={moreMenuRef}
          id="site-more-menu"
          className="site-nav-more-menu motion-presence"
          data-state={morePresence.visible ? "open" : "closed"}
          aria-hidden={!morePresence.visible}
          role="menu"
          aria-label="More navigation"
        >
          {NAV.slice(2).map(([href, label]) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                role="menuitem"
                aria-current={active ? "page" : undefined}
                className="site-nav-link pressable block rounded-lg px-3 py-2"
                onClick={() => setMoreOpen(false)}
              >
                {label}
              </Link>
            );
          })}
        </div>
      )}
    </header>
  );
}
