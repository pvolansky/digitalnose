'use server';
import { serverClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
export type AuthResult = { error?: string; message?: string };
export async function authenticate(_: AuthResult, form: FormData): Promise<AuthResult> {
  const email = String(form.get('email') || '').trim();
  const password = String(form.get('password') || '');
  const mode = String(form.get('mode'));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email address.' };
  const db = await serverClient();
  if (mode === 'resend') {
    const { error } = await db.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/confirm` },
    });
    if (error)
      return { error: 'Could not send a confirmation email. Please wait a minute and try again.' };
    return {
      message:
        'If this address has an unconfirmed account, a new confirmation email has been sent. Open only the newest link in this browser. Already confirmed? Sign in with your password.',
    };
  }
  if (password.length < 8 || password.length > 128)
    return { error: 'Enter a password of 8–128 characters.' };
  if (mode === 'signup') {
    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/confirm` },
    });
    if (error) return { error: error.message };
    if (!data.session)
      return { message: 'Check your email to confirm your account, then sign in.' };
  } else {
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error)
      return {
        error:
          error.code === 'email_not_confirmed'
            ? 'Your email is not confirmed yet. Use the newest confirmation email or request a new one below.'
            : 'Unable to sign in. Check your email and password.',
      };
  }
  redirect('/dashboard');
}
export async function signOut() {
  const db = await serverClient();
  await db.auth.signOut();
  redirect('/login');
}
