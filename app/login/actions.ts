'use server';
import { serverClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
export type AuthResult = {
  error?: string;
  message?: string;
  confirmationRequired?: boolean;
  existingAccount?: boolean;
  accountReady?: boolean;
};
export async function authenticate(_: AuthResult, form: FormData): Promise<AuthResult> {
  const email = String(form.get('email') || '').trim();
  const password = String(form.get('password') || '');
  const mode = String(form.get('mode'));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email address.' };
  if (mode === 'signup' && password !== String(form.get('confirm_password') || ''))
    return { error: 'Passwords do not match. Enter the same password in both fields.' };
  const db = await serverClient();
  if (mode === 'resend') {
    const { error } = await db.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/confirm` },
    });
    if (error)
      return {
        confirmationRequired: _.confirmationRequired,
        error:
          error.code === 'over_email_send_rate_limit'
            ? 'Activation email sending is temporarily unavailable because the email limit has been reached. Check for an earlier email, or try again later.'
            : 'Could not send a confirmation email. Please wait a minute and try again.',
      };
    return {
      confirmationRequired: true,
      message:
        'If this address has an unconfirmed account, Supabase has sent a new activation email. Use the newest link. Already activated? Sign in with your password.',
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
    if (
      error?.code === 'user_already_exists' ||
      (!error && !data.session && data.user?.identities?.length === 0)
    ) {
      return {
        existingAccount: true,
        message: 'This email is already registered. Sign in with your existing password.',
      };
    }
    if (error)
      return {
        error:
          error.code === 'over_email_send_rate_limit'
            ? 'Activation email sending is temporarily unavailable because the email limit has been reached. We could not complete signup. Try again later, or sign in if you already have an account.'
            : error.message,
      };
    if (!data.session)
      return {
        confirmationRequired: true,
      };
    return { accountReady: true };
  } else {
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error)
      return {
        confirmationRequired: error.code === 'email_not_confirmed',
        error:
          error.code === 'email_not_confirmed'
            ? 'Your account needs activation before you can sign in. Open the newest Supabase activation email, or request another below.'
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
