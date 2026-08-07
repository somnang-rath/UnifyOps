# 01 — Security model: web · admin · live · space

## 1. ស្ថានភាពឥឡូវ (findings)

ពិនិត្យ `apps/api/src/main.ts`, `apps/api/src/modules/auth/`, `apps/web/src/lib/`,
`apps/admin/src/lib/auth.ts`, `apps/live/src/auth.ts` — ២០២៦-០៧-១៧៖

| # | រកឃើញ | ហានិភ័យ | អាទិភាព |
| - | ------ | -------- | -------- |
| S1 | Access token ស្ថិតក្នុង `localStorage` — **admin ប៉ុណ្ណោះ** (`prism_admin_token`)។ *កែតម្រូវ ២០២៦-០៧-១៧: web ប្រើ Zustand in-memory រួចហើយ (គ្មាន persist) — ស្អាតជាងការស្មាន* | XSS ណាមួយ = លួច admin token បាន | 🔴 ខ្ពស់ |
| S2 | Refresh token ជា httpOnly cookie តែ **គ្មាន CSRF token** | `credentials: true` + cookie → CSRF លើ `/auth/refresh` | 🔴 ខ្ពស់ |
| S3 | `apps/live` ទទួល **access token ដដែល** របស់ web ត្រង់ៗតាម WebSocket | token ចេញក្រៅ boundary; socket ភ្ជាប់យូរ មិន re-check expiry ក្រោយ connect | 🔴 ខ្ពស់ |
| S4 | admin (god-mode) ប្រើ JWT **ដូច web** — គ្មាន audience ដាច់ | token លួចពី web tab = ចូល instance admin បាន (បើ user ជា instance admin) | 🔴 ខ្ពស់ |
| S5 | គ្មាន step-up re-auth មុនធ្វើសកម្មភាព instance (ប្តូរ SMTP, AI key, auth toggles) | session hijack → គ្រប់គ្រង instance ទាំងមូល | 🟠 មធ្យម |
| S6 | គ្មាន audit log សម្រាប់ instance/workspace admin actions | មិនអាចដឹងថានរណាប្តូរអ្វី | 🟠 មធ្យម |
| S7 | Rate limit មានតែលើ `public` module | brute-force លើ `/auth/login` | 🟠 មធ្យម |
| S8 | គ្មាន session revocation (logout មិន kill refresh token គ្រប់ device) | token ដែលលួចនៅតែប្រើបាន | 🟠 មធ្យម |
| S9 | CSP `useDefaults` + `frame-ancestors` តែប៉ុណ្ណោះ | space ជា public → XSS ក្នុង published HTML | 🟠 មធ្យម |
| S10 | Instance config (SMTP password, AI key) ត្រឡប់មក admin ជា plaintext? ត្រូវផ្ទៀងផ្ទាត់ | secret leak តាម API response | 🟠 មធ្យម |

## 2. Trust model គោលដៅ `[PROPOSED]`

```
                       ┌──────────────────────────────┐
                       │   apps/api :4000  (/api/v1)  │
                       │  ★ អ្នកសម្រេចតែម្នាក់ ★      │
                       └───▲────────▲────────▲─────▲───┘
        aud=web           │        │        │     │  aud=internal (LIVE_INTERNAL_TOKEN)
   ┌───────────────────────┘        │        │     └──────────────┐
   │              aud=admin ────────┘        │ (គ្មាន token)      │
┌──┴────────┐   ┌──────────────┐   ┌─────────┴──────┐   ┌────────┴────────┐
│ web :3000 │   │ admin :3001  │   │  space :3002   │   │  live :3100     │
│  user     │   │ instance     │   │  anonymous     │   │  aud=collab     │
│           │   │ admin+stepup │   │  SSR read-only │   │  scoped 1 doc   │
└─────┬─────┘   └──────────────┘   └────────────────┘   └────────▲────────┘
      │                    aud=collab (short-lived, 1 doc)       │
      └─────────────────────────────────────────────────────────┘
```

**គោលការណ៍ `[LOCKED បើយល់ព្រម]`**
1. **Token មាន 4 ប្រភេទ ដាច់ដោយឡែក** — មិនប្តូរគ្នាបានទេ (`aud` claim ខុសគ្នា):

   | Token | `aud` | អាយុ | ទុកនៅឯណា | ប្រើសម្រាប់ |
   | ----- | ----- | ---- | --------- | ----------- |
   | User access | `web` | 15 នាទី | **memory តែប៉ុណ្ណោះ** | `apps/web` → API |
   | Refresh | — | 7 ថ្ងៃ | httpOnly · Secure · SameSite=Lax · path=`/api/v1/auth` | ចេញ access ថ្មី |
   | Admin access | `admin` | 15 នាទី + step-up claim | memory | `apps/admin` → instance endpoints |
   | Collab | `collab` | **5 នាទី** + `doc` claim | memory (renew មុនផុត) | web → `apps/live` |
   | (space) | គ្មាន | — | — | anonymous read |

2. **`aud` ត្រូវបាន verify** — JWT strategy បដិសេធ token ដែល `aud` មិនត្រូវ route class។
   Token ពី web មិនអាចហៅ `/instance/*` បានទេ សូម្បី user ជា instance admin។
3. **live មិនឃើញ user token ទៀតទេ** — web សុំ `POST /wiki/:id/collab-token` (aud=collab, doc=wiki:<id>,
   5 នាទី) រួចផ្ញើទៅ live។ live verify `aud` + `doc` ត្រូវនឹង documentName។
   ក្រោយ connect → re-check រៀងរាល់ 5 នាទី; token ផុត ហើយ renew មិនបាន → disconnect។ (S3)
4. **space គ្មាន credential ណាមួយ** — SSR fetch ពី server តែប៉ុណ្ណោះ, គ្មាន token ក្នុង browser,
   `robots`/`sitemap` គ្រប់គ្រងបាន, published HTML ត្រូវ sanitize **ទាំង API និង space**។
5. **API ជាអ្នកសម្រេចតែម្នាក់** — គ្មាន frontend ណាធ្វើ authz ក្នុងខ្លួនឯង (UI hiding ≠ security)។

## 3. ការងារត្រូវធ្វើ

> **ស្ថានភាព (ផ្ទៀងផ្ទាត់នឹងកូដ 2026-07-31)** — **23/23 រួច**។ Phase 5 ត្រូវបានសម្គាល់ ✅
> តាំងពីយូរមកហើយ តែ checkbox ខាងក្រោមមិនដែលបានគូស ដូច្នេះ "Phase 5 ✅" ធ្លាប់លាក់
> **ចន្លោះពិត ៣** (live limits · web/admin CSP · per-page indexing)។ ទាំងបីបិទ
> 2026-07-31 ហើយបញ្ជីនេះឆ្លុះបញ្ចាំងកូដមែនទែន មិនមែនចេតនាទេ។

### 3.1 Auth core (apps/api) — ✅ 10/10
- [x] បន្ថែម `aud` ចូល JWT sign + verify; `JwtStrategy` ទទួល `audience` parameter
- [x] `@Audience('admin')` decorator + guard; `@InstanceAdminGuard` require `aud=admin`
- [x] Refresh rotation + reuse detection (refresh token family; ប្រើឡើងវិញ = revoke ទាំង family)
- [x] Session schema (userId, tokenHash, device, ip, ua, revokedAt) → session revocation + "sign out everywhere" (S8)
      — ដាក់ឈ្មោះ `RefreshToken` (`auth/schemas/refresh-token.schema.ts`) មិនមែន `RefreshSession`
- [x] CSRF: double-submit token លើ `/auth/refresh` + `SameSite=Lax` + `path` តូច (S2) — `common/auth/cookies.ts`
- [x] `@nestjs/throttler` global: login 5/នាទី/IP, refresh 20/នាទី, public 60/នាទី (S7)
- [x] Step-up: `POST /auth/step-up` (password ម្តងទៀត) → claim `stepUpAt`; instance mutations ទាមទារ < 15 នាទី (S5)
- [x] `AuditLog` schema + interceptor លើ instance/workspace admin mutations (S6)
- [x] Instance config: secret fields (SMTP pass, AI key) → write-only, response ត្រឡប់ `••••` + `isSet: true` (S10)
- [x] `POST /wiki/:id/collab-token` — mint collab token (S3)

### 3.2 Clients (web/admin) — ✅ 4/4
- [x] លុប localStorage token → access token **in-memory** + silent refresh on 401 (S1) — `auth-store.ts` គ្មាន `localStorage` សោះ
- [x] Boot: `/auth/refresh` ម្តងពេលចាប់ផ្តើម → rehydrate (ជំនួស localStorage)
- [x] admin login ដាច់ដោយឡែក → `aud=admin`; web "God Mode" link នាំទៅ admin login (មិន share token)
- [x] `@prism/services` ត្រូវដឹង audience នៅពេល `createApiClient({ audience })`

### 3.3 live — ✅ 3/3 (បិទ 2026-07-31)
- [x] `onAuthenticate` verify `aud=collab` + `doc` claim ត្រូវនឹង documentName — `live/src/auth.ts`
- [x] Periodic re-auth timer (5 នាទី) + disconnect ពេលបាត់សិទ្ធិ — `live/src/reauth.ts`
- [x] **Payload limit + connection limit** — `live/src/limits.ts` + `live/src/index.ts`។
      ដែនកំណត់បី ដាក់នៅបីស្រទាប់ខុសគ្នាដោយចេតនា (ទាំងអស់តាម env, default ក្នុង `env.ts`)៖
      - `LIVE_MAX_PAYLOAD_BYTES` (1 MiB) — `ws` បិទ frame ធំ ដោយ close 1009 មុននឹង buffer។
        ធំល្មមសម្រាប់ Yjs sync ព្រោះរូបភាពក្នុង editor ជា URL មិនមែន base64។
      - `LIVE_MAX_CONNECTIONS` (500) — បដិសេធនៅ HTTP upgrade (503) មុន Hocuspocus
        បម្រុងអ្វីទាំងអស់។ នេះជាដែនកំណត់ដែលទប់ client ដែលមិនដែល authenticate។
      - `LIVE_MAX_CONNECTIONS_PER_DOC` (30) — ក្នុង `onConnect`, រាប់តែ connection ដែល
        established (ត្រូវការ auth រួច) ដូច្នេះវាទប់អ្នកប្រើ authenticated ម្នាក់
        មិនឲ្យបើក socket គ្មានដែនលើ doc តែមួយ។

      **កំហុសពិតដែលរកឃើញពេលធ្វើតេស្ត៖** `maxPayload` តែម្នាក់ឯង ធ្វើឲ្យស្ថានការណ៍
      *អាក្រក់ជាងមុន*។ `ws` បញ្ចេញ event `'error'` លើ socket ពេល frame ធំពេក ហើយ
      Hocuspocus មិនដាក់ listener `'error'` ទេ — ក្នុង Node `'error'` ដែលគ្មាន listener
      គឺ throw។ ដូច្នេះ frame ធំតែមួយពី client ណាមួយ សម្លាប់ server ទាំងមូល។
      `index.ts` ឥឡូវដាក់ `ws.on('error', …)` **មុន** ប្រគល់ socket ទៅ Hocuspocus។
      `test:limits` មាន check ដាច់ដោយឡែកសម្រាប់រឿងនេះ។

      *ចំណាំ UX:* Hocuspocus រាយការណ៍ការ throw ក្នុង `onConnect` ទៅ client ជា
      authentication failure ដូច្នេះការបដិសេធដោយ per-doc cap លេចឡើងក្នុង UI ជា
      "token refused" (`useCollaborativeDoc.ts`)។ ទទួលយកបាន ព្រោះ 30/doc ខ្ពស់ជាង
      ការប្រើប្រាស់ពិតច្រើន — តែបើថ្ងៃណាដាក់ cap ទាប ត្រូវបំបែក signal នេះជាមុនសិន។

      Verify: `pnpm --filter live test:limits` (7 checks) — boot live ដាច់ដោយឡែក
      លើ :3111 ជាមួយ limit តូច (4 conns · 2/doc · 64 KiB) ហើយពិត៖ close 1009,
      server រស់, 503 នៅ upgrade, capacity ត្រឡប់មកវិញ, និង per-doc cap ជាមួយ
      collab token ពិត។

### 3.4 space — ✅ 3/3 (បិទ 2026-07-31)
- [x] Sanitize ២ ជាន់ (API ពេល publish + space ពេល render)
- [x] CSP តឹង — ⚠️ **កែឡើងវិញ 2026-07-31**។ Policy ចាស់ក្នុង `space/next.config.mjs`
      ប្រកាស `script-src 'self'` **គ្មាន nonce** ដែលមើលទៅតឹងជាងគេក្នុងបី app
      តែតាមពិត**ខូចជាងគេ**៖ App Router ផ្ញើ RSC payload តាម inline `<script>`
      ដូច្នេះ script ទាំង ៩ ត្រូវបាន block ហើយ **Space មិនដែល hydrate សោះ**។
      គ្មានអ្នកកត់សម្គាល់ ព្រោះទំព័រ read-only មើលទៅដូចគ្នាទាំងពីរករណី —
      រកឃើញជា console noise ក្នុង `test:browser-smoke`។
      ឥឡូវ `space/src/middleware.ts` ប្រើ nonce តាម request ដូច web/admin
      (policy រួមក្នុង `@prism/constants`)។ `frame-ancestors 'none'`,
      `X-Frame-Options: DENY`, `Permissions-Policy` នៅដដែល។

      ⚠️ **កែសម្រាប់ apps/web 2026-08-07** — `frame-ancestors 'none'` +
      `X-Frame-Options: DENY` ខុសសម្រាប់ web៖ split-pane editor បង្ហាញ route
      ជិតខាងក្នុង `<iframe>` **same-origin** (`?chrome=0`) ដូច្នេះ browser
      បដិសេធ frame នោះ ហើយគូរ error page ខ្លួនឯង — pane អានថា
      "localhost refused to connect" ដែលមើលទៅដូច server ស្លាប់ ជាជាង header។
      ឥឡូវ web ប្រើ `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN`
      (cross-origin នៅតែបដិសេធ ដែលជាករណី clickjacking ពិត); admin និង space
      នៅ `'none'`/`DENY` ដដែល ព្រោះវាគ្មាន iframe សោះ។ ចំណុចពីរបន្ថែម៖
      `STATIC_SECURITY_HEADERS` ក្លាយជា function `staticSecurityHeaders({...})`
      ព្រោះ `X-Frame-Options` ត្រូវតែស្របនឹង `frame-ancestors` — DENY ដែលភ្លេច
      ទុក block frame ដោយខ្លួនឯង ទោះ CSP ត្រឹមត្រូវ; ហើយ `frame-src` ត្រូវ
      ប្រកាសច្បាស់ ព្រោះវាធ្លាក់ទៅ `default-src 'self'` ដែល block PDF preview
      (API origin / `blob:`) និង video embed (YouTube/Vimeo) ស្ងាត់ៗ។

      **អន្ទាក់ពីរដែលរកឃើញពេលបើក app ពិត — មិនលេចក្នុង typecheck ឬ build៖**
      (១) Next វិភាគ `config` ជា static; ទម្រង់ដែលវាអានមិនបាន **មិនមែន error**
      ទេ — វា**បោះបង់ middleware ទាំងស្រុង** (`middleware: {}` ក្នុង manifest,
      គ្មាន header ចេញសោះ)។ ដូច្នេះ matcher ត្រូវជា array នៃ string literal ធម្មតា។
      (២) `(...)` ក្នុង matcher ជា *unnamed parameter* របស់ path-to-regexp
      មិនមែន regex group ទេ ហើយវាទាមទារយ៉ាងតិច ១ តួ — ដូច្នេះ pattern
      exclusion តែម្នាក់ឯង **មិនដែលផ្គូផ្គង root** ដែលក្រោម basePath គឺជា
      landing page របស់ app ខ្លួនឯង (`/god-mode`, `/spaces`)។ ត្រូវដាក់ `'/'` ដាច់ដោយឡែក។
- [x] **Indexing តាមទំព័រ** (S9) *(បិទ 2026-07-31)* — field ថ្មី `publicIndexing`
      (default `true`) លើ `WikiPage` · `View` · `Project` ទាំងបី។ `POST /:id/publish`
      ឥឡូវទទួល body ស្រេចចិត្ត `{ indexing?: boolean }` (schema រួម
      `common/anchor.util.ts` — endpoint បីមិនត្រូវបែកជាបីរូបរាង)។ Public payload
      មាន `indexable` ហើយ `apps/space` បំលែងវាជា `<meta name="robots">` តាមទំព័រ។

      **ជម្រើសអនុវត្ត៖** `<meta robots>` មិនមែន header `X-Robots-Tag` — header ក្នុង
      `next.config.mjs` ផ្គូផ្គងតាម path pattern ហើយ `[anchor]` ជាករណីដែល pattern
      សម្រេចមិនបាន។ សម្រាប់ទំព័រ HTML ពីរនេះស្មើគ្នាចំពោះ crawler ទាំងអស់។
      `SPACE_INDEXING=off` នៅតែជា override ថ្នាក់ instance — ខាងតឹងឈ្នះជានិច្ច។

      ចំណុចពីរដែលងាយភ្លាត់៖ (១) `indexing` ដែលមិនបានផ្ញើ **មិនប្ដូរ**តម្លៃដែលរក្សាទុក
      ព្រោះ publish ជា idempotent — ម្ចាស់ republish ដើម្បី refresh ហើយវាមិនត្រូវបើក
      ទំព័រទៅ crawler ឡើងវិញដោយស្ងាត់; (២) document ចាស់គ្មាន key នេះសោះ
      (Mongoose default អនុវត្តតែពេលសរសេរ) ដូច្នេះ public service ប្រើ `?? true`។

      **នេះមិនមែន access control** — ទំព័រ noindex នៅតែអានបានដោយអ្នកកាន់ link។
      Verify: `test:publish-space` 16→**21** + ពិនិត្យ meta ពិតលើ :3002
      (`indexing=false` → `noindex, nofollow, noarchive, nocache`)។
- [x] Public endpoint response គ្មាន `_id` ខាងក្នុង, email, member list

### 3.5 Infra — 🟡 2.5/3
- [x] Secrets ទាំងអស់ចេញពី `.env` ទៅ env schema validation + កុំ log
- [x] `helmet` CSP តឹង**តាម app** (បិទ 2026-07-31) — `apps/web` និង `apps/admin`
      ឥឡូវមាន CSP តាម request តាមរយៈ `src/middleware.ts` រៀងៗខ្លួន, ដោយ policy
      រួមគ្នាក្នុង `@prism/constants/security-headers` (កុំឲ្យ app ពីរបែកគ្នា)។

      **មិនអាចចម្លងលំនាំ `space/next.config.mjs` ត្រង់ៗបានទេ** ដូចដែល §3.6 ធ្លាប់
      សរសេរ។ Space គេចផុតដោយ policy static ព្រោះវាគ្មាន inline script ផ្ទាល់ខ្លួន។
      Web/admin មាន — theme boot script មុន first paint — ហើយ App Router ផ្ញើ RSC
      payload តាម inline `<script>`។ `script-src 'self'` ទទេនឹងខ្ទេច hydration;
      `'unsafe-inline'` នឹងអនុញ្ញាតឲ្យ `<script>` ដែលគេ inject ដំណើរការ ពោលគឺ
      header ដែលមើលទៅដូច CSP តែពិតជាមិនការពារអ្វីទាល់តែសោះ។ ដូច្នេះ៖ **nonce
      ថ្មីរាល់ request**, បញ្ជូនទៅ Next តាម CSP header របស់ request ខ្លួនឯង
      និងទៅ inline script របស់យើងតាម `x-nonce`។
      ថ្លៃដែលត្រូវបង់៖ `headers()` ក្នុង layout ធ្វើឲ្យ app ចេញពី static rendering —
      គ្មានឥទ្ធិពលពិត ព្រោះគ្រប់ page សុទ្ធតែ per-user រួចហើយ។

      Dev បន្ថែម `'unsafe-eval'` + `ws://localhost:*` (react-refresh, HMR) ប៉ុណ្ណោះ។
      `connect-src` បង្កើតពី env ជា **គូ** http(s) + ws(s) ព្រោះ Socket.io ចាប់ផ្ដើម
      ដោយ long-poll ទៅ host មុននឹង upgrade — អនុញ្ញាតតែមួយ បណ្ដាលឲ្យ fail មើលទៅ
      ដូច server ដាច់។

      Verify: `pnpm --filter web test:csp` (**24** checks លើ web + admin + space) —
      មិនត្រឹមតែអាន header ទេ៖
      អះអាងថា script គ្រប់ tag មាន nonce, nonce ប្ដូរតាម request, app ដំណើរការ
      ពិត (hydration + collab socket) ក្រោម policy, violation សូន្យ, **និង**
      `<script>` ដែល inject ចូល ពិតជាត្រូវបាន block។
- [x] Docker: live/api internal network តែប៉ុណ្ណោះ — ⚠️ **សេចក្ដីអះអាងនេះខុស**
      (រកឃើញ 2026-07-31)។ Service `live` **មាន** `ports: - "3100:3100"` ក្នុង
      `docker-compose.yml`។ វាត្រូវតែមាន៖ browser តភ្ជាប់ទៅ live ដោយផ្ទាល់តាម
      `NEXT_PUBLIC_LIVE_URL`, មិនឆ្លងកាត់ api ទេ — ដូច្នេះ :3100 **ត្រូវតែ**ចេញក្រៅ។
      អ្វីដែលការពារ live មិនមែន network isolation ទេ គឺ Origin allowlist ពេល
      upgrade + `onAuthenticate` + ដែនកំណត់ថ្មីក្នុង §3.3។ ទុក checkbox ជាគូស
      ព្រោះលទ្ធផលសុវត្ថិភាពសម្រេចបាន តែ**ហេតុផលដែលសរសេរទុកខុស**។

### 3.6 នៅសល់ពី audit 2026-07-31

តាមលំដាប់អាទិភាព៖

1. ~~**live: `maxPayload` + connection limit** (§3.3)~~ — ✅ បិទ 2026-07-31
2. ~~**web/admin CSP** (§3.5)~~ — ✅ បិទ 2026-07-31
3. ~~**per-page `X-Robots-Tag`** (§3.4)~~ — ✅ បិទ 2026-07-31

**Audit 2026-07-31 បិទទាំងបី។** គ្មានចន្លោះ "ពិត" នៅសល់ក្នុងឯកសារនេះទេ។

## 4. Definition of done
E2E អះអាងបាន៖ web token មិនអាចហៅ `/instance/*` (403) · collab token មិនអាចហៅ REST API ·
collab token របស់ doc A មិនអាចបើក doc B · localStorage គ្មាន token · refresh reuse → revoke ទាំង family ·
space response គ្មាន private field · login brute-force ជាប់ throttle។
