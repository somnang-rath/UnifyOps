import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { themeInitScript } from '@/components/theme';

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
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
