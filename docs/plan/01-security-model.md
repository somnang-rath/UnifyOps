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

> **ស្ថានភាព (ផ្ទៀងផ្ទាត់នឹងកូដ 2026-07-31)** — 20/23 រួច។ Phase 5 ត្រូវបានសម្គាល់ ✅
> តាំងពីយូរមកហើយ តែ checkbox ខាងក្រោមមិនដែលបានគូស ដូច្នេះ "Phase 5 ✅" លាក់
> **ចន្លោះពិត ៣**។ បញ្ជីនេះឥឡូវឆ្លុះបញ្ចាំងកូដមែនទែន មិនមែនចេតនាទេ។

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

### 3.3 live — 🟡 2/3
- [x] `onAuthenticate` verify `aud=collab` + `doc` claim ត្រូវនឹង documentName — `live/src/auth.ts`
- [x] Periodic re-auth timer (5 នាទី) + disconnect ពេលបាត់សិទ្ធិ — `live/src/reauth.ts`
- [ ] **Payload limit + connection limit ក្នុង 1 doc** — `new WebSocketServer({ noServer: true })`
      ក្នុង `live/src/index.ts:51` គ្មាន `maxPayload` និងគ្មានដែនកំណត់ connection ទេ។
      Client ដែល authenticate ហើយ អាចផ្ញើ frame ធំគ្មានដែន ឬបើក connection គ្មានដែន
      លើ doc តែមួយ។ **នេះជាចន្លោះពិត — DoS surface, មិនមែន checkbox ភ្លេចគូសទេ។**

### 3.4 space — 🟡 2.5/3
- [x] Sanitize ២ ជាន់ (API ពេល publish + space ពេល render)
- [x] CSP តឹង (`default-src 'self'`, `script-src 'self'`, គ្មាន inline script) — `space/next.config.mjs`
      + `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Permissions-Policy`
- [ ] `X-Robots-Tag` **តាម publish setting** (S9) — ឥឡូវមានតែ switch ថ្នាក់ instance
      (`SPACE_INDEXING=off` ក្នុង `space/src/app/robots.ts`)។ ការគ្រប់គ្រងតាមទំព័រ
      ត្រូវការ field ក្នុង `PublishSettings` របស់ API។ *ការពន្យារដោយចេតនា ហើយកូដសរសេរប្រាប់រួច។*
- [x] Public endpoint response គ្មាន `_id` ខាងក្នុង, email, member list

### 3.5 Infra — 🟡 2.5/3
- [x] Secrets ទាំងអស់ចេញពី `.env` ទៅ env schema validation + កុំ log
- [ ] `helmet` CSP តឹង**តាម app** — `apps/api` មាន helmet ហើយ `apps/space` មាន CSP ផ្ទាល់ខ្លួន,
      តែ **`apps/web` និង `apps/admin` គ្មាន CSP header សោះ**។ ពួកវាជា authenticated app
      ដែលដំណើរការកូដអ្នកប្រើ (Tiptap, markdown) — ត្រូវការ CSP ជាងគេ។ **ចន្លោះពិត។**
- [x] Docker: live/api internal network តែប៉ុណ្ណោះ — service `live` គ្មាន `ports:` mapping
      ក្នុង `docker-compose.yml` ដូច្នេះ :3100 មិនចេញក្រៅ

### 3.6 នៅសល់ពី audit 2026-07-31

តាមលំដាប់អាទិភាព៖

1. **live: `maxPayload` + connection limit** (§3.3) — S, DoS surface ពិត
2. **web/admin CSP** (§3.5) — S, ចម្លងលំនាំពី `space/next.config.mjs` រួចបន្ធូរឲ្យសម
   នឹង dev (Next ត្រូវការ `'unsafe-eval'` ក្នុង dev)
3. **per-page `X-Robots-Tag`** (§3.4) — S, តែត្រូវការ field ខាង API មុន

## 4. Definition of done
E2E អះអាងបាន៖ web token មិនអាចហៅ `/instance/*` (403) · collab token មិនអាចហៅ REST API ·
collab token របស់ doc A មិនអាចបើក doc B · localStorage គ្មាន token · refresh reuse → revoke ទាំង family ·
space response គ្មាន private field · login brute-force ជាប់ throttle។
