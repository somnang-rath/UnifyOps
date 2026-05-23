import type { Metadata } from 'next';
import { Inter, JetBrains_Mono, Kantumruy_Pro } from 'next/font/google';
import { ThemeBootScript } from '@/components/layout/theme-boot-script';
import { Providers } from '@/components/providers';
import '@/styles/globals.css';

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
  title: 'UnifyOps',
  description:
    'Plan, build, and ship — all in one beautiful workspace.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeBootScript />
      </head>
      <body className={`${inter.variable} ${mono.variable} ${kantumruy.variable} font-sans`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
