import { SongBrowser } from "@/components/SongBrowser";

export const metadata = { title: "Song library" };

export default function SongsPage() {
  return (
    <div className="page-shell max-w-6xl mx-auto px-4 py-8">
      <h1 className="page-title text-2xl font-bold mb-4 motion-rise-in">Song library</h1>
      <SongBrowser />
    </div>
  );
}
