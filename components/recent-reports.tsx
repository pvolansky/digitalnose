import React from 'react';
import type { SmellReport } from '@/lib/domain/types';
const intensityLabels = ['', 'Faint', 'Mild', 'Moderate', 'Strong', 'Very strong'];
export function RecentReports({ reports, timezone }: { reports: SmellReport[]; timezone: string }) {
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
              <div
                className="observation-intensity"
                aria-label={`Intensity: ${r.intensity} out of 5, ${intensityLabels[r.intensity]}`}
              >
                <span className="observation-score" aria-hidden="true">
                  {r.intensity}
                  <span> / 5</span>
                </span>
                <span className="observation-levels" aria-hidden="true">
                  {[1, 2, 3, 4, 5].map((level) => (
                    <span key={level} className={level <= r.intensity ? 'is-filled' : ''} />
                  ))}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No reports yet. When you notice a smell, add an observation.</p>
      )}
    </section>
  );
}
