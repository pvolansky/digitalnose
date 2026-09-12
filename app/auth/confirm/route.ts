import { NextResponse, type NextRequest } from 'next/server';
import { serverClient } from '@/lib/supabase/server';
import { confirmationDestination } from '@/lib/auth/confirmation';

export async function GET(request: NextRequest) {
  const db = await serverClient();
  const destination = await confirmationDestination(request.nextUrl.searchParams, db.auth);
  const response = NextResponse.redirect(new URL(destination, request.url));
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
