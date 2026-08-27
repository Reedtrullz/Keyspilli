import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { NavigationMotion } from "@/components/NavigationMotion";

export const metadata: Metadata = {
  title: { default: "Keyspilli — Play the songs you love", template: "%s · Keyspilli" },
  description: "Private piano-learning app: color-coded notes, falling notes, sheet music.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#18181b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <SiteHeader />
        <NavigationMotion />
        <main className="flex-1">{children}</main>
        <footer className="site-footer border-t border-zinc-200 py-6 text-xs text-zinc-500">
          <div className="max-w-6xl mx-auto px-4">Keyspilli — private piano practice. Made for one pianist.</div>
        </footer>
      </body>
    </html>
  );
}
