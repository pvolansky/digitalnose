import { siteContext } from '@/lib/domain/sites';
import { Shell } from '@/components/shell';
import { CreateSite } from '@/components/create-site';
import { SettingsForm } from '@/components/settings-form';
export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const { db, user, site, sites, role, devices } = await siteContext((await searchParams).site);
  if (!site)
    return (
      <Shell>
        <CreateSite />
      </Shell>
    );
  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .single();
  const { data: members, error: membersError } =
    role === 'owner'
      ? await db.rpc('list_site_residents', { target_site: site.id })
      : { data: [], error: null };
  const residents = (members || []) as {
    user_id: string;
    role: string;
    display_name: string;
    email: string;
  }[];
  if (profileError || membersError) throw new Error('Unable to load settings.');
  return (
    <Shell site={site} sites={sites}>
      <p className="eyebrow" style={{ marginTop: 40 }}>
        {site.name} · {role}
      </p>
      <h1>Your space.</h1>
      <section className="panel form">
        <h2>Your profile</h2>
        <p className="muted">{user.email}</p>
        <SettingsForm action="profile">
          <label>
            Display name
            <input name="name" defaultValue={profile?.display_name} maxLength={100} />
          </label>
        </SettingsForm>
      </section>
      {role === 'owner' ? (
        <>
          <section className="panel form">
            <h2>Site details</h2>
            <SettingsForm action="site" siteId={site.id}>
              <label>
                Site name
                <input name="name" defaultValue={site.name} required maxLength={100} />
              </label>
              <label>
                Timezone
                <input name="timezone" defaultValue={site.timezone} required />
              </label>
              <p className="muted">
                Weather location · Optional. Add both coordinates to enable external weather context
                from Open-Meteo. These coordinates are sent to the provider every 15 minutes.
              </p>
              <label>
                Latitude
                <input
                  name="latitude"
                  type="number"
                  step="any"
                  min="-90"
                  max="90"
                  defaultValue={site.latitude ?? ''}
                  placeholder="−90 to 90"
                />
              </label>
              <label>
                Longitude
                <input
                  name="longitude"
                  type="number"
                  step="any"
                  min="-180"
                  max="180"
                  defaultValue={site.longitude ?? ''}
                  placeholder="−180 to 180"
                />
              </label>
              <label className="row">
                <input
                  style={{ width: 'auto' }}
                  type="checkbox"
                  name="continuous_ventilation"
                  defaultChecked={site.continuous_ventilation}
                />
                Mechanical ventilation runs continuously
              </label>
            </SettingsForm>
          </section>
          <section className="panel">
            <h2>Residents</h2>
            <p className="muted">
              Share your sign-up link with a resident, then add their registered email below.
            </p>
            <p>
              <a
                style={{ textDecoration: 'underline', overflowWrap: 'anywhere' }}
                href={`${process.env.NEXT_PUBLIC_APP_URL}/login`}
              >
                {process.env.NEXT_PUBLIC_APP_URL}/login
              </a>
            </p>
            <div className="form">
              <SettingsForm action="add-resident" siteId={site.id} label="Add resident">
                <label>
                  Resident email
                  <input name="email" type="email" required />
                </label>
              </SettingsForm>
            </div>
            {residents.map((member) => (
              <div
                key={member.user_id}
                className="row spread"
                style={{ padding: '16px 0', borderBottom: '1px solid var(--line)' }}
              >
                <span style={{ overflowWrap: 'anywhere' }}>
                  {member.display_name || member.email} <span className="tag">{member.role}</span>
                </span>
                {member.role === 'resident' && (
                  <SettingsForm action="remove-resident" siteId={site.id} label="Remove resident">
                    <input type="hidden" name="user_id" value={member.user_id} />
                  </SettingsForm>
                )}
              </div>
            ))}
          </section>
          <section className="panel">
            <h2>Devices</h2>
            <p className="muted">
              Each Pi uses a unique identifier and an independently revocable API key.
            </p>
            {devices.map((device) => (
              <details
                key={device.id}
                style={{ padding: '16px 0', borderBottom: '1px solid var(--line)' }}
              >
                <summary style={{ cursor: 'pointer' }}>
                  {device.name} · {device.device_identifier}
                </summary>
                <div className="form" style={{ paddingTop: 24 }}>
                  <SettingsForm action="update-device" siteId={site.id}>
                    <input type="hidden" name="device_id" value={device.id} />
                    <label>
                      Device name
                      <input name="name" defaultValue={device.name} required maxLength={100} />
                    </label>
                    <label>
                      Device identifier
                      <input
                        name="device_identifier"
                        defaultValue={device.device_identifier}
                        required
                        maxLength={64}
                        pattern="[a-zA-Z0-9_-]+"
                      />
                    </label>
                  </SettingsForm>
                  <p className="muted">
                    Generating a key immediately revokes previous keys for this device. Update the
                    Pi after rotation.
                  </p>
                  <SettingsForm action="rotate-key" siteId={site.id} label="Generate / rotate key">
                    <input type="hidden" name="device_id" value={device.id} />
                  </SettingsForm>
                  <SettingsForm action="revoke-key" siteId={site.id} label="Revoke all device keys">
                    <input type="hidden" name="device_id" value={device.id} />
                  </SettingsForm>
                </div>
              </details>
            ))}
            <details style={{ marginTop: 24 }}>
              <summary style={{ cursor: 'pointer' }}>＋ Add a device</summary>
              <div className="form" style={{ paddingTop: 24 }}>
                <SettingsForm action="create-device" siteId={site.id} label="Add device">
                  <label>
                    Device name
                    <input name="name" placeholder="Living room" required maxLength={100} />
                  </label>
                  <label>
                    Device identifier
                    <input
                      name="device_identifier"
                      placeholder="diginose-001"
                      required
                      maxLength={64}
                      pattern="[a-zA-Z0-9_-]+"
                    />
                  </label>
                </SettingsForm>
              </div>
            </details>
          </section>
        </>
      ) : (
        <section className="panel">
          <p className="muted">Your site owner manages residents, devices and site settings.</p>
        </section>
      )}
    </Shell>
  );
}
