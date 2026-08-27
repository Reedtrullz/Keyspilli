export default function PlayerLoading() {
  return (
    <div className="page-shell max-w-6xl mx-auto w-full px-4 py-6" aria-busy="true" aria-label="Loading player">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="space-y-2">
          <div className="loading-skeleton h-6 w-48 rounded-lg" />
          <div className="loading-skeleton h-4 w-32 rounded-lg" />
        </div>
        <div className="loading-skeleton h-7 w-24 rounded-full" />
      </div>
      <div className="loading-skeleton mb-4 h-12 w-full rounded-2xl" />
      <div className="surface-card overflow-hidden rounded-2xl border p-4">
        <div className="loading-skeleton mb-4 h-3 w-full rounded-full" />
        <div className="loading-skeleton h-[22rem] w-full rounded-xl" />
      </div>
      <p className="sr-only" role="status">Loading player controls and score</p>
    </div>
  );
}
