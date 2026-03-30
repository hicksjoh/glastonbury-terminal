import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import CommandBar from '@/components/CommandBar';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Glastonbury Terminal',
  description: 'Personal wealth command center — The Glastonbury Group',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className} style={{ backgroundColor: '#08080d', color: '#e8e8e8', minHeight: '100vh' }}>
        <CommandBar />
        {children}
      </body>
    </html>
  );
}
