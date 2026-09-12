import { confirmationNotice } from '@/lib/auth/confirmation';
import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { AuthForm } from '@/components/auth-form';
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ confirmation?: string; session?: string }>;
}) {
  const params = await searchParams;
  const notice =
    params.session === 'expired'
      ? 'Your session has ended. Sign in again to view your readings.'
      : confirmationNotice(params.confirmation);
  return (
    <main className="container auth-page">
      <Link href="/" className="brand">
        <BrandMark /> Digital Nose
      </Link>
      <div className="auth-card">
        <p className="eyebrow">A clearer picture of your air</p>
        <h1>Welcome home.</h1>
        <p className="muted">Connect your observations with the air around you.</p>
        {notice && (
          <p
            role="status"
            style={{
              padding: 16,
              border: '1px solid var(--line)',
              borderRadius: 6,
              marginBottom: 24,
            }}
          >
            {notice}
          </p>
        )}
        <AuthForm />
      </div>
      <p className="muted" style={{ marginTop: 28 }}>
        Just exploring?{' '}
        <Link href="/demo" style={{ textDecoration: 'underline' }}>
          View the demo
        </Link>
      </p>
    </main>
  );
}
