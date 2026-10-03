"use client";

import Link from "next/link";
import { NavigationFeedback } from "./NavigationFeedback";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { usePresence } from "./player/player-motion";
import { loadSettings } from "@keyspilli/player-core";
import { APP_THEME_EVENT, applyAppTheme, setAppTheme, type AppTheme } from "./app-theme";

const NAV = [
  ["/", "Home"],
  ["/songs", "Songs"],
  ["/artists", "Artists"],
  ["/uploads", "Add a song"],
] as const;

export function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const [theme, setTheme] = useState<AppTheme>("light");
  useEffect(() => {
    const sync = () => setTheme(document.documentElement.dataset.theme === "charcoal" ? "charcoal" : "light");
    const restore = () => applyAppTheme(loadSettings().stageTheme);
    window.addEventListener(APP_THEME_EVENT, sync);
    window.addEventListener("storage", restore);
    restore();
    return () => {
      window.removeEventListener(APP_THEME_EVENT, sync);
      window.removeEventListener("storage", restore);
    };
  }, []);
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
        <Link href="/" aria-label="Keyspilli" className="site-brand pressable shrink-0 font-bold text-lg tracking-tight">
          Keyspilli
          <NavigationFeedback destination="Home" />
        </Link>
        <nav className="site-nav flex shrink-0 gap-1 text-sm" aria-label="Main">
          {NAV.map(([href, label], index) => {
            const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={`site-nav-link site-nav-secondary-${index >= 2 ? "item" : "primary"} pressable px-3 py-1.5 rounded-full`}
              >
                {label}
                <NavigationFeedback destination={label} />
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
        <button type="button" className="site-theme-toggle" aria-label="Charcoal mode" aria-pressed={theme === "charcoal"}
          title={theme === "charcoal" ? "Switch to Light" : "Switch to Charcoal"}
          onClick={() => setAppTheme(theme === "charcoal" ? "light" : "charcoal")}>
          <span aria-hidden="true">{theme === "charcoal" ? "☀" : "☾"}</span>
        </button>
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
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className="site-nav-link pressable block rounded-lg px-3 py-2"
                onClick={() => setMoreOpen(false)}
              >
                {label}
                <NavigationFeedback destination={label} />
              </Link>
            );
          })}
        </div>
      )}
    </header>
  );
}
