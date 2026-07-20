import type { Metadata } from 'next';
import { Inter, JetBrains_Mono, Kantumruy_Pro, Koh_Santepheap } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { themeInitScript } from '@/components/theme';

// Same font stack as apps/web so admin doesn't drift onto system-ui — the
// shared Tailwind preset's font-sans/font-mono read these CSS variables.
const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-sans',
});
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
});
const kantumruy = Kantumruy_Pro({
  subsets: ['khmer', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-khmer',
});
const kohSantepheap = Koh_Santepheap({
  subsets: ['khmer', 'latin'],
  weight: ['300', '400', '700'],
  variable: '--font-koh-santepheap',
});

export const metadata: Metadata = {
  title: 'UnifyOps Admin',
  description: 'Instance administration for UnifyOps',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${inter.variable} ${mono.variable} ${kantumruy.variable} ${kohSantepheap.variable} font-sans`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
