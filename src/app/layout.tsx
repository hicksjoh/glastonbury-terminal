import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import CommandBar from '@/components/CommandBar';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    default: 'Glastonbury Terminal',
    template: '%s | Glastonbury Terminal',
  },
  description: 'Private wealth command center — The Glastonbury Group',
  keywords: ['trading', 'portfolio', 'wealth management', 'Glastonbury Group'],
  authors: [{ name: 'Wesley Hicks' }],
  creator: 'The Glastonbury Group',
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/icon-192.png',
  },
  manifest: '/manifest.json',
  openGraph: {
    title: 'Glastonbury Terminal',
    description: 'Private wealth command center',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Glastonbury" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className={inter.className} style={{ backgroundColor: '#08080d', color: '#e8e8e8', minHeight: '100vh' }}>
        <Providers>
          <CommandBar />
          {children}
        </Providers>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').then(
                    function(reg) { console.log('[SW] registered, scope:', reg.scope); },
                    function(err) { console.warn('[SW] registration failed:', err); }
                  );
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
