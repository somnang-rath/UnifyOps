/**
 * Access-token session shared by apps/web and apps/admin.
 *
 * The token lives in a module-scoped variable and nowhere else — never
 * localStorage, never sessionStorage. Any XSS can still *use* the running page,
 * but it cannot read a token out of storage and walk away with a session that
 * outlives the tab. A reload rehydrates from the httpOnly refresh cookie
 * instead. docs/plan/01-security-model.md §1 S1 / §3.2.
 */

export type SessionAudience = 'web' | 'admin';

export interface SessionUser {
  id: string;
  email: string;
  name?: string;
  role?: string;
  [key: string]: unknown;
}

export interface AuthResponse {
  accessToken: string;
  csrfToken?: string;
  user: SessionUser;
}

export interface SessionOptions {
  /** e.g. http://localhost:4000/api/v1 */
  baseURL: string | undefined;
  /** Which app this session belongs to — decides the `aud` claim and cookie. */
  audience: SessionAudience;
  /** Notified whenever the token changes (null = signed out). */
  onChange?: (token: string | null, user: SessionUser | null) => void;
}

export function createSession(opts: SessionOptions) {
  let accessToken: string | null = null;
  let user: SessionUser | null = null;
  let refreshing: Promise<string | null> | null = null;

  const url = (path: string) => `${opts.baseURL ?? ''}${path}`;

  function set(token: string | null, nextUser: SessionUser | null) {
    accessToken = token;
    user = nextUser;
    opts.onChange?.(token, nextUser);
  }

  /** Cookie-authenticated calls must echo the CSRF cookie. */
  function csrfHeaders(): Record<string, string> {
    if (typeof document === 'undefined') return {};
    const m = document.cookie.match(/(?:^|;\s*)prism_csrf=([^;]*)/);
    return m ? { 'X-CSRF-Token': decodeURIComponent(m[1]) } : {};
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(url(path), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...csrfHeaders(),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const data = await res.json();
        message = data?.message ?? data?.error ?? message;
      } catch {
        // non-JSON error body — keep the status text
      }
      throw Object.assign(new Error(message), { status: res.status });
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  return {
    getToken: () => accessToken,
    getUser: () => user,

    async login(email: string, password: string): Promise<SessionUser> {
      const data = await post<AuthResponse>('/auth/login', {
        email,
        password,
        audience: opts.audience,
      });
      set(data.accessToken, data.user);
      return data.user;
    },

    /**
     * Exchange the refresh cookie for a new access token. Concurrent callers
     * share one in-flight request so a burst of 401s cannot start a rotation
     * stampede (each rotation spends the cookie).
     */
    async refresh(): Promise<string | null> {
      refreshing ??= (async () => {
        try {
          const data = await post<AuthResponse>('/auth/refresh', {
            audience: opts.audience,
          });
          set(data.accessToken, data.user);
          return data.accessToken;
        } catch {
          set(null, null);
          return null;
        } finally {
          refreshing = null;
        }
      })();
      return refreshing;
    },

    /** Call once on app boot: a reload has no token, only the cookie. */
    async restore(): Promise<SessionUser | null> {
      const token = await this.refresh();
      return token ? user : null;
    },

    async logout(): Promise<void> {
      try {
        await post<void>('/auth/logout', { audience: opts.audience });
      } finally {
        set(null, null);
      }
    },

    async logoutEverywhere(): Promise<void> {
      try {
        await post<void>('/auth/logout-all', {});
      } finally {
        set(null, null);
      }
    },

    /** Re-enter the password to unlock instance mutations for 15 minutes. */
    async stepUp(password: string): Promise<void> {
      const data = await post<{ accessToken: string }>('/auth/step-up', {
        password,
      });
      set(data.accessToken, user);
    },
  };
}

export type Session = ReturnType<typeof createSession>;
