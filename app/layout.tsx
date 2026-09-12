import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Digital Nose',
  description: 'An open-source distributed odour-monitoring platform.',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
