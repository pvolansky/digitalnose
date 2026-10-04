import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/auth/',
        '/login',
        '/dashboard',
        '/settings',
        '/captures',
        '/report',
        '/demo/settings',
        '/demo/journal',
      ],
    },
    sitemap: 'https://www.digitalnose.ai/sitemap.xml',
  };
}
