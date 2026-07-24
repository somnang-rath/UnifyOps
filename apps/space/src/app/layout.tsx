import type { Metadata } from 'next';
import { Inter, JetBrains_Mono, Kantumruy_Pro } from 'next/font/google';
import './globals.css';

// Same type family as web/admin — a published page should look like it came
// from the product, because it did (docs/plan/02). Kantumruy Pro covers Khmer.
// next/font self-hosts the files at build, so they load under the Space's
// strict CSP (font-src 'self').
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

export const metadata: Metadata = {
  title: 'Prism · Space',
  description: 'Published content from Prism',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${mono.variable} ${kantumruy.variable} font-sans`}
      >
        {children}
      </body>
    </html>
  );
}
