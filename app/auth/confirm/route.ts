import { NextResponse, type NextRequest } from 'next/server';
import { serverClient } from '@/lib/supabase/server';
export async function GET(request: NextRequest) {
  const db = await serverClient();
  const params = request.nextUrl.searchParams;
  const token = params.get('token_hash');
  const code = params.get('code');
  if (token) {
    const { error } = await db.auth.verifyOtp({ token_hash: token, type: 'email' });
    if (!error) return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  if (code) {
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  return NextResponse.redirect(new URL('/login?confirmation=failed', request.url));
}
