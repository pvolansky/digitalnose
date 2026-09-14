import React from 'react';
import type { SmellReport } from '@/lib/domain/types';
const intensityLabels = ['', 'Faint', 'Mild', 'Moderate', 'Strong', 'Very strong'];
function ObservationIntensity({ intensity }: { intensity: number }) {
  return (
    <div
      className="observation-intensity"
      aria-label={`Intensity: ${intensity} out of 5, ${intensityLabels[intensity]}`}
    >
      <span className="observation-score" aria-hidden="true">
        {intensity}
        <span> / 5</span>
      </span>
      <span className="observation-levels" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((level) => (
          <span key={level} className={level <= intensity ? 'is-filled' : ''} />
        ))}
      </span>
    </div>
  );
}
export function RecentReports({
  reports,
  timezone,
  compact = false,
}: {
  reports: SmellReport[];
  timezone: string;
  compact?: boolean;
}) {
  if (compact)
    return (
      <section className="panel journal-panel" aria-label="Observations">
        {reports.length ? (
          <div className="journal-table-scroll">
            <table className="journal-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Observation</th>
                  <th scope="col">Intensity</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <time dateTime={r.reported_at}>
                        {new Intl.DateTimeFormat('en-GB', {
                          timeZone: timezone,
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        }).format(new Date(r.reported_at))}
                        <span className="journal-time">
                          {new Intl.DateTimeFormat('en-GB', {
                            timeZone: timezone,
                            hour: '2-digit',
                            minute: '2-digit',
                          }).format(new Date(r.reported_at))}
                        </span>
                      </time>
                    </td>
                    <td>
                      <span className="journal-type">{r.smell_type || 'Smell reported'}</span>
                      <span className="journal-resident">
                        {r.reporter_display_name?.trim() || 'Resident'}
                      </span>
                      {r.note && <p className="journal-note">{r.note}</p>}
                    </td>
                    <td>
                      <ObservationIntensity intensity={r.intensity} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No observations yet. Record a smell from now or earlier.</p>
        )}
      </section>
    );
  return (
    <section className="panel recent-observations">
      <h2>Recent observations</h2>
      {reports.length ? (
        <ul className="observation-list">
          {reports.map((r) => (
            <li key={r.id} className="observation-item">
              <div className="observation-content">
                <p className="observation-title">
                  {r.smell_type || `${intensityLabels[r.intensity]} smell`}
                </p>
                <div className="observation-meta">
                  <span>{r.reporter_display_name?.trim() || 'Resident'}</span>
                  <span aria-hidden="true">·</span>
                  <time dateTime={r.reported_at}>
                    {new Intl.DateTimeFormat('en-GB', {
                      timeZone: timezone,
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(new Date(r.reported_at))}
                  </time>
                </div>
                {r.note && <p className="observation-note">{r.note}</p>}
              </div>
              <ObservationIntensity intensity={r.intensity} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No reports yet. When you notice a smell, add an observation.</p>
      )}
    </section>
  );
}
