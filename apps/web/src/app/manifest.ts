import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sellavant',
    short_name: 'Sellavant',
    description:
      'A professional AI workspace for Amazon sellers building A+ content, brand guides, and operational workflows.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#152A4A',
    icons: [
      {
        src: '/sellavant-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/sellavant-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/sellavant-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/sellavant-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
