import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

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

const NAV = [
  ["/", "Home"],
  ["/songs", "Songs"],
  ["/artists", "Artists"],
  ["/uploads", "Upload"],
  ["/youtube", "YouTube"],
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <header className="border-b border-zinc-200 bg-white sticky top-0 z-40">
          <div className="max-w-6xl mx-auto px-4 py-2 flex flex-wrap items-center gap-x-6 gap-y-1">
            <Link href="/" className="font-bold text-lg tracking-tight">
              Keyspilli
            </Link>
            <nav className="flex gap-1 text-sm" aria-label="Main">
              {NAV.map(([href, label]) => (
                <Link key={href} href={href} className="px-3 py-1.5 rounded-full hover:bg-zinc-100">
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-zinc-200 py-6 text-xs text-zinc-500">
          <div className="max-w-6xl mx-auto px-4">Keyspilli — private piano practice. Made for one pianist.</div>
        </footer>
      </body>
    </html>
  );
}
