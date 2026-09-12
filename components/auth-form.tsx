'use client';
import { useActionState, useState } from 'react';
import { authenticate } from '@/app/login/actions';
export function AuthForm() {
  const [mode, setMode] = useState('login');
  const [state, action, pending] = useActionState(authenticate, {});
  return (
    <form action={action} className="stack">
      <input type="hidden" name="mode" value={mode} />
      <div>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={8}
          maxLength={128}
          required
        />
      </div>
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
        {pending ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
      <button
        type="button"
        className="secondary"
        onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
      >
        {mode === 'login' ? 'New here? Create an account' : 'Already registered? Sign in'}
      </button>
    </form>
  );
}
