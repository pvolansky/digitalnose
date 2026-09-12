export default function Loading() {
  return (
    <main className="container loading-page" aria-busy="true" aria-label="Loading Digital Nose">
      <span className="eyebrow" role="status">
        Loading your space…
      </span>
      <div className="skeleton skeleton-title" />
      <div className="panel metrics">
        {[1, 2, 3].map((n) => (
          <div key={n}>
            <div className="skeleton skeleton-label" />
            <div className="skeleton skeleton-value" />
          </div>
        ))}
      </div>
      <div className="panel">
        <div className="skeleton skeleton-label" />
        <div className="skeleton skeleton-chart" />
      </div>
    </main>
  );
}
