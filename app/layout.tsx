import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  metadataBase: new URL('https://digitalnose.ai'),
  title: 'Digital Nose',
  icons: { icon: { url: '/favicon.svg', type: 'image/svg+xml' } },
  description: 'An open-source distributed odour-monitoring platform.',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
