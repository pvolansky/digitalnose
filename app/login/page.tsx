import Link from 'next/link';
import { AuthForm } from '@/components/auth-form';
export default function Login() {
  return (
    <main className="container" style={{ maxWidth: 500, paddingTop: 90 }}>
      <Link href="/" className="brand">
        ◉ DIGITAL NOSE
      </Link>
      <p className="eyebrow" style={{ marginTop: 64 }}>
        A clearer picture of your air
      </p>
      <h1>Welcome home.</h1>
      <p className="muted">Connect your observations with the air around you.</p>
      <AuthForm />
      <p className="muted" style={{ marginTop: 28 }}>
        Just exploring?{' '}
        <Link href="/demo" style={{ textDecoration: 'underline' }}>
          View the demo
        </Link>
      </p>
    </main>
  );
}
