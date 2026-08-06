import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Inter, JetBrains_Mono, Kantumruy_Pro, Koh_Santepheap } from 'next/font/google';
import { NONCE_HEADER } from '@prism/constants';
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
  // Per-request CSP nonce from src/middleware.ts. The pre-paint theme script is
  // inline, so without this the policy blocks it and every load flashes.
  const nonce = headers().get(NONCE_HEADER) ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          suppressHydrationWarning: browsers hide the nonce content attribute
          after parsing (it would otherwise be readable via CSS attribute
          selectors and defeat the nonce), so React's hydration compare reads
          "" off the DOM and warns about a mismatch that isn't one.
        */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body className={`${inter.variable} ${mono.variable} ${kantumruy.variable} ${kohSantepheap.variable} font-sans`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
