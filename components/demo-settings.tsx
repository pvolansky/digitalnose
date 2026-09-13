'use client';
import { useState, type ReactNode } from 'react';

function ExampleForm({
  children,
  label = 'Save changes',
}: {
  children: ReactNode;
  label?: string;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="stack"
      onChange={() => setSaved(false)}
      onSubmit={(event) => {
        event.preventDefault();
        setSaved(true);
      }}
    >
      {children}
      <button type="submit">{label}</button>
      {saved && (
        <p className="success" role="status">
          Updated in this preview only. Nothing was sent or saved to an account.
        </p>
      )}
    </form>
  );
}

export function DemoSettings() {
  const [residents, setResidents] = useState(['Sam']);
  const [key, setKey] = useState('');
  return (
    <>
      <section className="panel form">
        <h2>Your profile</h2>
        <p className="muted">alex@example.com</p>
        <ExampleForm>
          <label>
            Display name
            <input defaultValue="Alex" maxLength={100} />
          </label>
        </ExampleForm>
      </section>
      <section className="panel form">
        <h2>Site details</h2>
        <ExampleForm>
          <label>
            Site name
            <input defaultValue="Home · Living room" required maxLength={100} />
          </label>
          <label>
            Timezone
            <select defaultValue="Europe/London">
              <option>Europe/London</option>
              <option>UTC</option>
              <option>America/New_York</option>
            </select>
          </label>
          <p className="muted">
            Weather location · Synthetic example coordinates, unrelated to any installation. This
            demo does not request weather for this location.
          </p>
          <label>
            Latitude
            <input type="number" min="-90" max="90" step="any" defaultValue="12.345" required />
          </label>
          <label>
            Longitude
            <input type="number" min="-180" max="180" step="any" defaultValue="-34.567" required />
          </label>
          <label className="row">
            <input type="checkbox" defaultChecked style={{ width: 'auto' }} />
            Mechanical ventilation runs continuously
          </label>
        </ExampleForm>
      </section>
      <section className="panel">
        <h2>Residents</h2>
        <p className="muted">
          Residents can report smells. The owner manages devices and room context.
        </p>
        <div className="row spread" style={{ padding: '16px 0' }}>
          <span>
            Alex <span className="tag">owner</span>
          </span>
        </div>
        {residents.map((name) => (
          <div
            className="row spread"
            key={name}
            style={{ padding: '16px 0', borderTop: '1px solid var(--line)' }}
          >
            <span>
              {name} <span className="tag">resident</span>
            </span>
            <button
              className="secondary"
              onClick={() => setResidents(residents.filter((item) => item !== name))}
            >
              Remove {name}
            </button>
          </div>
        ))}
        <button
          className="secondary"
          disabled={residents.includes('Jamie')}
          onClick={() => setResidents([...residents, 'Jamie'])}
        >
          Add example resident
        </button>
        <p className="muted">Example people only. No invitations are sent.</p>
      </section>
      <section className="panel">
        <h2>Devices</h2>
        <p className="muted">Each Pi has its own identifier and revocable API key.</p>
        <details open>
          <summary>Living room · diginose-demo</summary>
          <div className="form" style={{ paddingTop: 24 }}>
            <ExampleForm>
              <label>
                Device name
                <input defaultValue="Living room" required maxLength={100} />
              </label>
              <label>
                Device identifier
                <input
                  defaultValue="diginose-demo"
                  required
                  pattern="[a-zA-Z0-9_-]+"
                  maxLength={64}
                />
              </label>
            </ExampleForm>
            <p className="muted">
              Preview the key controls. Example keys cannot authenticate a device.
            </p>
            <div className="row">
              <button onClick={() => setKey('DEMO-ONLY-NOT-A-VALID-API-KEY')}>
                Generate example key
              </button>
              <button className="secondary" disabled={!key} onClick={() => setKey('')}>
                Revoke example key
              </button>
            </div>
            <p role="status" style={{ overflowWrap: 'anywhere' }}>
              {key || 'No active example key.'}
            </p>
          </div>
        </details>
      </section>
    </>
  );
}
