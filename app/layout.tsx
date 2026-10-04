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
      <head>
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-BYMPPR28SW" />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-BYMPPR28SW');`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
