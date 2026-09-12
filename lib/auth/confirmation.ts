type ConfirmationError = { code?: string } | null;
type ConfirmationAuth = {
  verifyOtp: (input: {
    token_hash: string;
    type: 'email';
  }) => Promise<{ error: ConfirmationError }>;
  exchangeCodeForSession: (code: string) => Promise<{ error: ConfirmationError }>;
};

/** Confirmation can succeed even when a different browser cannot exchange the PKCE code. */
export async function confirmationDestination(params: URLSearchParams, auth: ConfirmationAuth) {
  if (params.get('error_code') === 'otp_expired') return '/login?confirmation=expired';
  const token = params.get('token_hash');
  if (token) {
    const { error } = await auth.verifyOtp({ token_hash: token, type: 'email' });
    if (!error) return '/dashboard';
    return error.code === 'otp_expired'
      ? '/login?confirmation=expired'
      : '/login?confirmation=failed';
  }
  const code = params.get('code');
  if (code) {
    const { error } = await auth.exchangeCodeForSession(code);
    return error ? '/login?confirmation=signin' : '/dashboard';
  }
  // Supabase can return errors in the URL fragment, which is invisible to the server.
  return '/login?confirmation=failed';
}

export function confirmationNotice(status?: string) {
  if (status === 'signin')
    return 'We could not finish automatic sign-in. Your email may already be confirmed. Sign in with your email and password. Email links should be opened in the same browser where you signed up.';
  if (status === 'failed' || status === 'expired')
    return 'This confirmation link is invalid, expired or already used. If your email is already confirmed, sign in below. Otherwise, request a new confirmation email and use only the newest link.';
  return null;
}
