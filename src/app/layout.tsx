import type { Metadata } from 'next';
import { Inter, Fraunces, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import CommandBar from '@/components/CommandBar';
import MarketTickerBar from '@/components/MarketTickerBar';
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration';
import { Providers } from './providers';

// Three faces, wired via next/font so they self-host and preload.
// See docs/DESIGN-SYSTEM.md — Fraunces is the editorial voice for Keisha
// long-form (memos, briefings, coach reviews). JetBrains Mono had been
// CSS-only; now first-class.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-serif',
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

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
    <html
      lang="en"
      className={`dark ${inter.variable} ${fraunces.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Glastonbury" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body
        className={inter.className}
        style={{ backgroundColor: 'var(--bg)', color: 'var(--text)', minHeight: '100vh' }}
      >
        <a href="#main-content" className="skip-to-content">
          Skip to main content
        </a>
        <Providers>
          <CommandBar />
          <MarketTickerBar />
          {children}
        </Providers>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
