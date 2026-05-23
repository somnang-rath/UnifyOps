'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

function LoadingScreenContent() {
  return (
    <div className="loading-screen">
      <div className="loading-blob loading-blob-1" />
      <div className="loading-blob loading-blob-2" />

      <div className="loading-center">
        <div className="loading-rings">
          <div className="loading-ring loading-ring-outer" />
          <div className="loading-ring loading-ring-middle" />
          <div className="loading-ring loading-ring-inner" />

          <div className="loading-logo-wrap">
            <img
              src="/imgs/logo/Secondary_Logomark.svg"
              alt="UnifyOps"
              className="loading-logo"
              draggable={false}
            />
            <div className="loading-logo-glow" />
          </div>
        </div>

        <div className="loading-dots">
          <span className="loading-dot" style={{ animationDelay: '0ms' }} />
          <span className="loading-dot" style={{ animationDelay: '160ms' }} />
          <span className="loading-dot" style={{ animationDelay: '320ms' }} />
        </div>
      </div>

      <style>{`
        .loading-screen {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg);
          z-index: 9999;
          overflow: hidden;
        }

        .loading-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.18;
          animation: loading-blob-drift 8s ease-in-out infinite alternate;
        }
        .loading-blob-1 {
          width: 480px;
          height: 480px;
          background: #28a6df;
          top: -120px;
          left: -80px;
          animation-delay: 0s;
        }
        .loading-blob-2 {
          width: 360px;
          height: 360px;
          background: var(--a);
          bottom: -100px;
          right: -60px;
          animation-delay: -4s;
        }

        @keyframes loading-blob-drift {
          from { transform: translate(0, 0) scale(1); }
          to   { transform: translate(40px, 30px) scale(1.08); }
        }

        .loading-center {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 40px;
        }

        .loading-rings {
          position: relative;
          width: 160px;
          height: 160px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .loading-ring {
          position: absolute;
          border-radius: 50%;
          border: 2px solid transparent;
        }

        .loading-ring-outer {
          inset: 0;
          border-top-color: #28a6df;
          border-right-color: rgba(40,166,223,0.3);
          animation: loading-spin 2s linear infinite;
        }
        .loading-ring-middle {
          inset: 16px;
          border-top-color: var(--a);
          border-left-color: rgba(99,102,241,0.3);
          animation: loading-spin 1.4s linear infinite reverse;
        }
        .loading-ring-inner {
          inset: 32px;
          border-top-color: rgba(40,166,223,0.6);
          border-bottom-color: rgba(99,102,241,0.3);
          animation: loading-spin 1s linear infinite;
        }

        @keyframes loading-spin {
          to { transform: rotate(360deg); }
        }

        .loading-logo-wrap {
          position: relative;
          width: 72px;
          height: 72px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .loading-logo {
          width: 72px;
          height: 72px;
          object-fit: contain;
          animation: loading-logo-pulse 2.4s ease-in-out infinite;
          position: relative;
          z-index: 1;
        }
        .loading-logo-glow {
          position: absolute;
          inset: -8px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(40,166,223,0.35) 0%, transparent 70%);
          animation: loading-glow-pulse 2.4s ease-in-out infinite;
          filter: blur(6px);
        }

        @keyframes loading-logo-pulse {
          0%, 100% { opacity: 1;   transform: scale(1);    }
          50%       { opacity: 0.85; transform: scale(1.06); }
        }
        @keyframes loading-glow-pulse {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50%       { opacity: 1;   transform: scale(1.2); }
        }

        .loading-dots {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .loading-dot {
          display: block;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #28a6df;
          animation: loading-dot-bounce 1.2s ease-in-out infinite;
        }
        @keyframes loading-dot-bounce {
          0%, 80%, 100% { transform: translateY(0);   opacity: 0.4; }
          40%            { transform: translateY(-10px); opacity: 1;   }
        }
      `}</style>
    </div>
  );
}

export function LoadingScreen() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;
  return createPortal(<LoadingScreenContent />, document.body);
}
