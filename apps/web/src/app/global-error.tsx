'use client';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#0f0f11' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            gap: '16px',
            color: '#fff',
            textAlign: 'center',
            padding: '24px',
          }}
        >
          <AlertTriangle style={{ width: 40, height: 40, color: '#ef4444' }} />
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Application error</h1>
          <p style={{ fontSize: 14, color: '#888', margin: 0, maxWidth: 360 }}>
            A critical error occurred. Please refresh the page.
          </p>
          <button
            onClick={reset}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              background: '#6366f1',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <RefreshCw style={{ width: 14, height: 14 }} />
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
