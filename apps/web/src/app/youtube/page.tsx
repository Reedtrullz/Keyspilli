import Link from "next/link";

export default function YoutubePage() {
  return (
    <div className="page-shell max-w-2xl mx-auto px-4 py-10">
      <h1 className="page-title text-2xl font-bold mb-2 motion-rise-in">Create a lesson from a symbolic file</h1>
      <p className="text-zinc-600 text-sm mb-5 motion-rise-in">
        Keyspilli does not create lessons directly from YouTube audio. It creates them from MIDI, MusicXML, or MXL files whose musical timing is already defined.
      </p>
      <div className="surface-card rounded-2xl border border-zinc-200 p-5">
        <h2 className="font-semibold">Find a source lead or upload your file</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Enter the artist and title to search for metadata-only source leads, or skip search when you already have an authorized symbolic file.
        </p>
        <Link href="/uploads" className="pressable inline-block mt-4 px-4 py-2 rounded-full bg-zinc-900 text-white text-sm font-medium">
          Add a song
        </Link>
      </div>
    </div>
  );
}
