'use client';
import { startTransition, useActionState, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { unstable_rethrow } from 'next/navigation';
import type { AuthResult } from '@/app/login/actions';
import { LuLoaderCircle, LuMail } from 'react-icons/lu';
import { authenticate } from '@/app/login/actions';
type Mode = 'login' | 'signup' | 'resend';
export function AuthForm() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [revision, setRevision] = useState(0);
  return (
    <AuthFields
      key={revision}
      mode={mode}
      email={email}
      setEmail={setEmail}
      switchMode={(next) => {
        setMode(next);
        setRevision((value) => value + 1);
      }}
    />
  );
}
function AuthFields({
  mode,
  email,
  setEmail,
  switchMode,
}: {
  mode: Mode;
  email: string;
  setEmail: (email: string) => void;
  switchMode: (mode: Mode) => void;
}) {
  const [state, action, pending] = useActionState(
    async (previous: AuthResult, form: FormData): Promise<AuthResult> => {
      try {
        return await authenticate(previous, form);
      } catch (error) {
        unstable_rethrow(error);
        return {
          ...previous,
          error:
            'We could not confirm this request. Check your connection and try again. If you already submitted signup, check your inbox or try signing in.',
        };
      }
    },
    {},
  );
  const [password, setPassword] = useState('');
  const [confirmationPassword, setConfirmationPassword] = useState('');
  const noticeRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (state.confirmationRequired || state.existingAccount || state.accountReady) {
      noticeRef.current?.focus();
      noticeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [state]);
  if (state.accountReady)
    return (
      <section ref={noticeRef} tabIndex={-1} className="activation-notice stack" role="status">
        <h2>Account ready</h2>
        <p>Your account is active and you’re signed in.</p>
        <Link className="button" href="/dashboard">
          Continue to dashboard
        </Link>
      </section>
    );
  if (state.existingAccount)
    return (
      <section ref={noticeRef} tabIndex={-1} className="stack" style={{ marginTop: 24 }}>
        <div className="activation-notice" role="status">
          <h2>Already registered</h2>
          <p>
            <strong>{email}</strong> already has an account. Sign in with your existing password.
          </p>
        </div>
        <button type="button" onClick={() => switchMode('login')}>
          Go to sign in
        </button>
        <button type="button" className="secondary" onClick={() => switchMode('signup')}>
          Use a different email
        </button>
      </section>
    );
  const confirmation = state.confirmationRequired;
  const resend = confirmation || mode === 'resend';
  return (
    <form
      action={action}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const form = new FormData(event.currentTarget);
        startTransition(() => action(form));
      }}
      className="stack"
      aria-busy={pending}
    >
      <input type="hidden" name="mode" value={resend ? 'resend' : mode} />
      {confirmation && (
        <section
          ref={noticeRef}
          tabIndex={-1}
          className="activation-notice"
          aria-labelledby="activation-title"
          role="status"
        >
          <LuMail aria-hidden="true" />
          <h2 id="activation-title">Check your email</h2>
          <p>
            Check the inbox for <strong>{email}</strong>.
          </p>
          <ol>
            <li>Look for the activation email sent by Supabase for Digital Nose.</li>
            <li>Check your spam or junk folder if it hasn’t arrived.</li>
            <li>Open the newest activation link in this browser. Then sign in.</li>
          </ol>
          <p>
            Your email must be confirmed before you can use your account. Delivery can take a few
            minutes.
          </p>
        </section>
      )}
      {mode === 'signup' && !confirmation && (
        <aside className="signup-guidance" aria-labelledby="signup-guidance-title">
          <LuMail aria-hidden="true" />
          <div>
            <h2 id="signup-guidance-title">One quick email confirmation</h2>
            <p>
              After signup, look for an activation email from Supabase. Open the link to confirm
              your account before signing in.
            </p>
            <p className="muted">Can’t find it? Check your spam or junk folder.</p>
          </div>
        </aside>
      )}
      {mode === 'resend' && !confirmation && (
        <p className="muted">
          Enter your signup email to request a new activation link from Supabase. Check your inbox
          and spam or junk folder, and use only the newest link.
        </p>
      )}
      <div>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          readOnly={confirmation}
        />
      </div>
      {!resend && (
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={8}
            maxLength={128}
            required
          />
        </div>
      )}
      {mode === 'signup' && !resend && (
        <div>
          <label htmlFor="confirm-password">Confirm password</label>
          <input
            id="confirm-password"
            name="confirm_password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            value={confirmationPassword}
            onChange={(event) => setConfirmationPassword(event.target.value)}
            aria-describedby={
              confirmationPassword && confirmationPassword !== password
                ? 'password-mismatch'
                : undefined
            }
            aria-invalid={!!confirmationPassword && confirmationPassword !== password}
          />
          {confirmationPassword && confirmationPassword !== password && (
            <p id="password-mismatch" className="error">
              Passwords do not match.
            </p>
          )}
        </div>
      )}
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="success">
          {state.message}
        </p>
      )}
      <button disabled={pending}>
        {pending && <LuLoaderCircle className="spin" aria-hidden="true" />}
        {pending
          ? 'Please wait…'
          : resend
            ? 'Resend activation email'
            : mode === 'login'
              ? 'Sign in'
              : 'Sign up'}
      </button>
      <button
        disabled={pending}
        type="button"
        className="secondary"
        onClick={() => switchMode(confirmation || mode !== 'login' ? 'login' : 'signup')}
      >
        {confirmation ? 'Sign in' : mode === 'login' ? 'Sign up' : 'Sign in'}
      </button>
      {confirmation && (
        <button
          disabled={pending}
          type="button"
          className="secondary"
          onClick={() => switchMode('resend')}
        >
          Use a different email
        </button>
      )}
      {!resend && (
        <button
          type="button"
          className="secondary"
          disabled={pending}
          onClick={() => switchMode('resend')}
        >
          Resend activation email
        </button>
      )}
    </form>
  );
}
