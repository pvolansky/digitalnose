import 'server-only';
import { connection } from 'next/server';
// Capture time once per dynamic server request, then pass it to client components.
export async function requestTime() {
  await connection();
  return Date.now();
}
