'use client';
import { Component, ErrorInfo, ReactNode, useEffect } from 'react';
import { reportFrontendError } from '@/hooks/use-error-logs';
import { useAuthStore } from '@/stores/auth-store';
import type { CreateErrorLogPayload } from '@/schemas/error-log';

// ── Helpers ────────────────────────────────────────────────────────────────

function getBrowserInfo(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (ua.includes('Chrome') && !ua.includes('Edg')) return `Chrome/${ua.match(/Chrome\/([\d.]+)/)?.[1] ?? ''}`;
  if (ua.includes('Firefox')) return `Firefox/${ua.match(/Firefox\/([\d.]+)/)?.[1] ?? ''}`;
  if (ua.includes('Safari') && !ua.includes('Chrome')) return `Safari/${ua.match(/Version\/([\d.]+)/)?.[1] ?? ''}`;
  if (ua.includes('Edg')) return `Edge/${ua.match(/Edg\/([\d.]+)/)?.[1] ?? ''}`;
  return 'unknown';
}

function getOS(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac')) return 'macOS';
  if (ua.includes('Linux')) return 'Linux';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  return 'unknown';
}

function getDeviceType(): 'desktop' | 'mobile' | 'tablet' | 'unknown' {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|mini|windows\sce|palm/i.test(ua)) return 'mobile';
  return 'desktop';
}

function getCurrentRoute(): string {
  if (typeof window === 'undefined') return '';
  return window.location.pathname + window.location.search;
}

function buildPayload(
  title: string,
  message: string,
  stack?: string,
  extra?: Partial<CreateErrorLogPayload>,
): CreateErrorLogPayload {
  return {
    source: 'frontend',
    logType: 'error',
    errorTitle: title.slice(0, 500),
    errorMessage: message.slice(0, 10000),
    stackTrace: stack?.slice(0, 50000),
    pageRoute: getCurrentRoute(),
    browser: getBrowserInfo(),
    operatingSystem: getOS(),
    deviceType: getDeviceType(),
    applicationVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? '1.0.0',
    ...extra,
  };
}

// ── Global error listener hook ─────────────────────────────────────────────

export function useGlobalErrorCollector() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      reportFrontendError(
        buildPayload(
          event.error?.name ?? 'RuntimeError',
          event.message ?? 'Unknown error',
          event.error?.stack,
        ),
      );
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as Error | string | undefined;
      const message =
        reason instanceof Error ? reason.message : String(reason ?? 'Unhandled promise rejection');
      const stack = reason instanceof Error ? reason.stack : undefined;
      reportFrontendError(
        buildPayload('UnhandledPromiseRejection', message, stack),
      );
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);
}

// ── React Error Boundary ────────────────────────────────────────────────────

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, errorMessage: '' };

  static getDerivedStateFromError(err: Error): ErrorBoundaryState {
    return { hasError: true, errorMessage: err.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportFrontendError(
      buildPayload(
        error.name ?? 'ReactError',
        error.message,
        `${error.stack ?? ''}\n\nComponent stack:\n${info.componentStack ?? ''}`,
      ),
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex flex-col items-center justify-center min-h-[200px] gap-3 p-6 text-center">
            <div className="text-2xl">⚠️</div>
            <div className="text-[13px] font-semibold text-text">Something went wrong</div>
            <div className="text-[12px] text-text-muted max-w-sm">{this.state.errorMessage}</div>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, errorMessage: '' })}
              className="mt-2 h-8 px-4 rounded bg-accent hover:bg-accent-600 text-white text-[12px] font-medium transition-colors"
            >
              Try again
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

// ── Composite collector component ──────────────────────────────────────────

export function ErrorCollector({ children }: { children: ReactNode }) {
  useGlobalErrorCollector();
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
