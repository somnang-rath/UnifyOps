'use client';
import { Button } from '@/components/ui/button';
import { usePublicInstance } from '@/hooks/use-public-instance';

/**
 * OAuth start routes live on the API (ADR 0008 §3). These are full-page
 * navigations — the API 302s to the provider — so plain anchors, never fetch.
 */
const OAUTH_BASE = `${process.env.NEXT_PUBLIC_API_URL ?? '/api/v1'}/auth/oauth`;

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.46a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.11A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.28a7.2 7.2 0 0 1 0-4.56V6.61H1.27a12 12 0 0 0 0 10.78l4.01-3.11Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.98 11.98 0 0 0 1.27 6.61l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77Z"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .3a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .3Z" />
    </svg>
  );
}

/**
 * "Continue with Google/GitHub" — rendered only for providers the instance
 * reports as effectively enabled (toggle on + credentials present). With no
 * credentials configured, `GET /instance` reports false and nothing renders.
 */
export function OAuthButtons() {
  const { data } = usePublicInstance();
  const google = data?.config?.GOOGLE_OAUTH_ENABLED === true;
  const github = data?.config?.GITHUB_OAUTH_ENABLED === true;
  if (!google && !github) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 text-[11px] uppercase tracking-[.08em] text-text-muted">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      {google && (
        <Button asChild variant="outline" size="lg" full>
          <a href={`${OAUTH_BASE}/google`}>
            <GoogleIcon />
            Continue with Google
          </a>
        </Button>
      )}
      {github && (
        <Button asChild variant="outline" size="lg" full>
          <a href={`${OAUTH_BASE}/github`}>
            <GitHubIcon />
            Continue with GitHub
          </a>
        </Button>
      )}
    </div>
  );
}
