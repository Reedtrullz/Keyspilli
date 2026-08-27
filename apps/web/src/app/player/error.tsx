"use client";

import { useEffect } from "react";

export default function PlayerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Player render error:", error);
  }, [error]);

  return (
    <div className="page-shell flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold text-zinc-900">Something went wrong</h1>
      <p className="text-sm text-zinc-600 max-w-md text-center">
        The player hit an unexpected error. You can try again or return to the song library.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="pressable min-h-11 px-4 py-2 rounded-full bg-zinc-900 text-white font-medium hover:bg-zinc-700"
        >
          Try again
        </button>
        <a
          href="/"
          className="pressable min-h-11 px-4 py-2 rounded-full border border-zinc-300 font-medium hover:bg-zinc-100"
        >
          Back to library
        </a>
        {error.digest && (
          <span className="text-xs text-zinc-400 self-center">Ref: {error.digest}</span>
        )}
      </div>
    </div>
  );
}
