import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Analytics } from '@vercel/analytics/next';
import './global.css';

export const metadata: Metadata = {
  title: {
    default: 'Sellavant',
    template: '%s | Sellavant',
  },
  description:
    'Sellavant helps Amazon teams turn product data, brand assets, and source materials into cleaner decisions, better creative workflows, and ready-to-publish A+ content packages.',
  applicationName: 'Sellavant',
  metadataBase: new URL('https://sellavant.com'),
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/sellavant-icon-256.png',
  },
  openGraph: {
    title: 'Sellavant',
    description:
      'A professional AI workspace for Amazon sellers building A+ content, brand guides, and operational workflows.',
    url: 'https://sellavant.com',
    siteName: 'Sellavant',
    images: [
      {
        url: '/modern-dashboard-interface-with-charts-and-analyti.jpg',
        width: 1600,
        height: 900,
        alt: 'Sellavant dashboard preview',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sellavant',
    description:
      'A professional AI workspace for Amazon sellers building A+ content, brand guides, and operational workflows.',
    images: ['/modern-dashboard-interface-with-charts-and-analyti.jpg'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      style={{ colorScheme: 'light' }}
    >
      <body className="font-sans antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
