import type { SmellReport } from '@/lib/domain/types';
const intensityLabels = ['', 'Faint', 'Mild', 'Moderate', 'Strong', 'Very strong'];
export function RecentReports({ reports, timezone }: { reports: SmellReport[]; timezone: string }) {
  return (
    <section className="panel">
      <h2>Recent observations</h2>
      {reports.length ? (
        reports.map((r) => (
          <article
            key={r.id}
            className="row spread"
            style={{ padding: '18px 0', borderBottom: '1px solid var(--line)' }}
          >
            <div className="row">
              <time
                className="muted"
                dateTime={r.reported_at}
                style={{ fontSize: 13, minWidth: 115 }}
              >
                {new Intl.DateTimeFormat('en-GB', {
                  timeZone: timezone,
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(new Date(r.reported_at))}
              </time>
              <div>
                <p style={{ margin: 0 }}>
                  {r.smell_type || `${intensityLabels[r.intensity]} smell`}
                </p>
                {r.note && (
                  <p
                    className="muted"
                    style={{ fontSize: 13, margin: '4px 0', overflowWrap: 'anywhere' }}
                  >
                    {r.note}
                  </p>
                )}
              </div>
            </div>
            <span className="tag">{r.intensity} / 5</span>
          </article>
        ))
      ) : (
        <p className="muted">No reports yet. When you notice a smell, add an observation.</p>
      )}
    </section>
  );
}
