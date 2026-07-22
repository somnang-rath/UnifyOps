# ADR 0008 — Phase 4: Google + GitHub OAuth login

- Status: Accepted (GATE — build against this)
- Date: 2026-07-22
- Scope: OAuth **login for `apps/web` only** (`aud=web`). Admin (God Mode) keeps
  password login — step-up requires a password, so an OAuth-only admin session
  would be useless there. Magic-link login is out of scope.
- Owners of build: `prism-backend` (auth module additions),
  `prism-frontend` (login buttons in apps/web, admin config UI fields).
- Constraint: **no external credentials exist yet.** Everything ships code-complete
  but *effectively disabled*; flipping it on later is pure configuration.

## Context

The instance module already has the switches: `GOOGLE_OAUTH_ENABLED` /
`GITHUB_OAUTH_ENABLED` are `PUBLIC_CONFIG_KEYS` and `GOOGLE_CLIENT_SECRET` /
`GITHUB_CLIENT_SECRET` are `SECRET_CONFIG_KEYS` (`instance/dto/instance.dto.ts`).
The Phase 5 session model (docs/plan/01-security-model.md) is non-negotiable:
access tokens live in memory only, sessions bootstrap from the `prism_rt_web`
httpOnly refresh cookie plus `prism_csrf` via `POST /auth/refresh`, and **no token
ever appears in a URL or localStorage**. OAuth must land inside that model, not
beside it.

Decisions marked **LOCKED** are frozen; the build implements them verbatim.

## Decision

### 1. Credential source + "effectively enabled" (**LOCKED**)

Per provider, resolved server-side at request time (never cached at boot):

```
clientId     = instanceConfig[<P>_CLIENT_ID]      || env.<P>_CLIENT_ID      || ''
clientSecret = instanceConfig[<P>_CLIENT_SECRET]  || env.<P>_CLIENT_SECRET  || ''
enabled      = instanceConfig[<P>_OAUTH_ENABLED] === 'true'
             && clientId !== '' && clientSecret !== ''
```

- New **optional** envSchema keys (`apps/api/src/config/env.config.ts`):
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`,
  `GITHUB_CLIENT_SECRET` — all `z.string().optional()`. Missing = fine.
- `GOOGLE_CLIENT_ID` / `GITHUB_CLIENT_ID` become instance-config keys
  (category `auth`, **non-secret** — client ids are public by design). The
  secrets are already covered by `SECRET_CONFIG_KEYS`.
- New server-side resolver `InstanceService.getOAuthConfig(provider)` →
  `{ enabled, clientId, clientSecret }`. Secret-bearing; never returned by a
  controller (same rule as `getAiConfig`).
- **`GET /instance` reports the EFFECTIVE boolean**: `getPublicInstance()`
  overwrites `GOOGLE_OAUTH_ENABLED` / `GITHUB_OAUTH_ENABLED` in its `config`
  map with the effective value. Clients never learn *why* a provider is off
  (toggle vs missing credentials) — just the boolean. Frontends render the
  OAuth buttons from this and need no other change to stay dark today.

### 2. No Passport OAuth strategies (**LOCKED**)

We do **not** add `passport-google-oauth20` / `passport-github2`. Passport
strategies capture `clientID`/`clientSecret` at construction time; ours are
runtime-mutable instance config, which would force strategy re-registration
hacks. Passport's OAuth flow also wants a session/state store we don't run.
The authorization-code flow is two `fetch` calls per provider; instead we
build a small `OAuthService` with a frozen provider table:

| | Google | GitHub |
| - | ------ | ------ |
| authorize | `https://accounts.google.com/o/oauth2/v2/auth` | `https://github.com/login/oauth/authorize` |
| token | `https://oauth2.googleapis.com/token` | `https://github.com/login/oauth/access_token` |
| profile | `https://openidconnect.googleapis.com/v1/userinfo` | `https://api.github.com/user` + `/user/emails` |
| scope | `openid email profile` | `read:user user:email` |

**Zero new dependencies.** Existing `passport`/`passport-jwt` stay as-is for
access-token verification.

### 3. Endpoints (**LOCKED** — live in the auth module: `oauth.controller.ts`, `oauth.service.ts`)

```
GET /api/v1/auth/oauth/:provider            @Public(), @Throttle short 10/min
  → 404 NotFound if provider ∉ {google, github} or not effectively enabled
  → set state cookie, 302 to provider authorize URL

GET /api/v1/auth/oauth/:provider/callback   @Public(), @Throttle short 10/min
  → 404 if not effectively enabled (same rule — disabling kills in-flight flows)
  → verify state, exchange code, resolve user, set session cookies,
    302 to web app. NEVER returns a token in a URL or body.
```

**State/CSRF**: the start route generates `state = randomBytes(24).hex`, stores
it in cookie `prism_oauth_state` (httpOnly, `secure` in prod, `sameSite=lax`,
`path=/api/v1/auth/oauth`, maxAge 10 min — helper added next to
`common/auth/cookies.ts` patterns) and sends the same value as the `state`
query param. The callback requires cookie == query param, then clears the
cookie. `sameSite=lax` is safe because the provider redirect is a top-level
GET navigation. The `CsrfGuard` (header echo) does not apply to these GET
navigations; the state cookie *is* the CSRF defense here.

### 4. Callback → session handoff (**LOCKED** — Phase 5 compliant)

On success the callback does **exactly** what password login does:
`setRefreshCookie(res, refreshToken, AUD_WEB)` + `setCsrfCookie(res)` via
`AuthService.issueTokens(user, AUD_WEB, meta)` — with **`stepUp: false`**
(only a password proves possession; OAuth login never unlocks instance
mutations). Then `302 → <webOrigin>/` where `webOrigin` = first entry of the
`WEB_ORIGIN` list. The web app's existing boot path calls `/auth/refresh`,
finds the cookie, and hydrates the in-memory access token. No token, no user
data, nothing but the path in the redirect URL.

On failure: `302 → <webOrigin>/login?error=<code>` with a frozen code enum:
`oauth_failed` (state mismatch, token exchange error, no verified email),
`signup_disabled`, `account_disabled`. Codes are deliberately coarse — no
provider error details leak into URLs.

### 5. User resolution + new-user rule (**LOCKED**)

`User` schema gains (unique **sparse** indexes, same pattern as `inviteToken`):

```ts
@Prop({ type: String, default: null, unique: true, sparse: true }) googleId?: string | null;
@Prop({ type: String, default: null, unique: true, sparse: true }) githubId?: string | null;
```

Resolution order in `OAuthService`:

1. **By provider id** (`googleId`/`githubId`) → login.
2. **By verified email** → link (set the provider id) → login. Google: require
   `email_verified === true`; GitHub: use the *primary + verified* entry from
   `/user/emails`. Unverified/absent email → `oauth_failed` (email-match linking
   on an unverified email is an account-takeover vector).
   A verified-email match also clears `invitePending` — OAuth proves email
   ownership at least as strongly as the invite token would.
3. **New user** → allowed only when effective signup is on:
   instance config `ENABLE_SIGNUP === 'true'` if the row is set, else env
   `ALLOW_PUBLIC_REGISTER` (config-over-env, consistent with §1). Created with
   `name` from the provider profile, `role: 'dev'`, and `passwordHash` =
   bcrypt of 48 random bytes (password login effectively disabled until the
   user sets one). Signup off + no match → `signup_disabled`.

`blocked` users are rejected (`account_disabled`) at every path, mirroring
password login.

### 6. Callback URLs to register (**LOCKED** — exact strings)

Callback base = `API_URL` env if set, else `http://localhost:4000` (dev).

| | Dev | Prod (placeholder) |
| - | --- | ------------------ |
| Google (Cloud console → Credentials → Authorized redirect URIs) | `http://localhost:4000/api/v1/auth/oauth/google/callback` | `https://api.<your-domain>/api/v1/auth/oauth/google/callback` |
| GitHub (OAuth App → Authorization callback URL) | `http://localhost:4000/api/v1/auth/oauth/github/callback` | `https://api.<your-domain>/api/v1/auth/oauth/github/callback` |

Google also needs `http://localhost:3000` (dev) / the web origin (prod) as an
Authorized JavaScript origin. GitHub Homepage URL = the web origin.

## Consequences

- With no credentials configured, both routes 404 and `GET /instance` reports
  `false` — ship-safe today, config-only to enable later.
- OAuth-created users cannot pass step-up (no known password) → they cannot
  perform instance mutations until they set a password. Acceptable; instance
  admins are few and password-based.
- Admin toggling a provider off kills new logins immediately (effective check
  runs per request), but existing sessions live until their refresh family dies.
- The admin auth settings page needs two new fields (client ids) next to the
  existing secret fields; no new admin endpoint.
- Adding GitLab later = one row in the provider table + existing
  `GITLAB_CLIENT_SECRET` key; no contract change.

## Interfaces frozen by this ADR (build against these)

- Env: optional `GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|GITHUB_CLIENT_ID|GITHUB_CLIENT_SECRET`
- Resolver: `InstanceService.getOAuthConfig('google'|'github')` → `{ enabled, clientId, clientSecret }` (server-side only)
- `GET /instance` → `config.GOOGLE_OAUTH_ENABLED` / `config.GITHUB_OAUTH_ENABLED` are **effective** booleans
- Routes: `GET /api/v1/auth/oauth/:provider` and `.../callback` — `@Public()`, throttled, 404 when not effectively enabled
- State cookie: `prism_oauth_state` (httpOnly, lax, `path=/api/v1/auth/oauth`, 10 min)
- Success: sets `prism_rt_web` + `prism_csrf`, `302 → <webOrigin>/`; failure: `302 → <webOrigin>/login?error=oauth_failed|signup_disabled|account_disabled`
- Schema: `User.{ googleId, githubId }` — unique sparse, default null
