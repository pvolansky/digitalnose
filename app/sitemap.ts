import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: 'https://www.digitalnose.ai/' }, { url: 'https://www.digitalnose.ai/demo' }];
}
