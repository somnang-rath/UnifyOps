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

### 3.1 Auth core (apps/api)
- [ ] បន្ថែម `aud` ចូល JWT sign + verify; `JwtStrategy` ទទួល `audience` parameter
- [ ] `@Audience('admin')` decorator + guard; `@InstanceAdminGuard` require `aud=admin`
- [ ] Refresh rotation + reuse detection (refresh token family; ប្រើឡើងវិញ = revoke ទាំង family)
- [ ] `RefreshSession` schema (userId, tokenHash, device, ip, ua, revokedAt) → session revocation + "sign out everywhere" (S8)
- [ ] CSRF: double-submit token លើ `/auth/refresh` + `SameSite=Lax` + `path` តូច (S2)
- [ ] `@nestjs/throttler` global: login 5/នាទី/IP, refresh 20/នាទី, public 60/នាទី (S7)
- [ ] Step-up: `POST /auth/step-up` (password ម្តងទៀត) → claim `stepUpAt`; instance mutations ទាមទារ < 15 នាទី (S5)
- [ ] `AuditLog` schema + interceptor លើ instance/workspace admin mutations (S6)
- [ ] Instance config: secret fields (SMTP pass, AI key) → write-only, response ត្រឡប់ `••••` + `isSet: true` (S10)
- [ ] `POST /wiki/:id/collab-token` — mint collab token (S3)

### 3.2 Clients (web/admin)
- [ ] លុប localStorage token → access token **in-memory** + silent refresh on 401 (មានក្នុង `@prism/services` រួច) (S1)
- [ ] Boot: `/auth/refresh` ម្តងពេលចាប់ផ្តើម → rehydrate (ជំនួស localStorage)
- [ ] admin login ដាច់ដោយឡែក → `aud=admin`; web "God Mode" link នាំទៅ admin login (មិន share token)
- [ ] `@prism/services` ត្រូវដឹង audience នៅពេល `createApiClient({ audience })`

### 3.3 live
- [ ] `onAuthenticate` verify `aud=collab` + `doc` claim ត្រូវនឹង documentName
- [ ] Periodic re-auth timer (5 នាទី) + disconnect ពេលបាត់សិទ្ធិ
- [ ] Payload limit + connection limit ក្នុង 1 doc

### 3.4 space
- [ ] Sanitize ២ ជាន់ (API ពេល publish + space ពេល render)
- [ ] CSP តឹង (`default-src 'self'`, គ្មាន inline script), `X-Robots-Tag` តាម publish setting (S9)
- [ ] Public endpoint response គ្មាន `_id` ខាងក្នុង, email, member list

### 3.5 Infra
- [ ] Secrets ទាំងអស់ចេញពី `.env` ទៅ env schema validation (មានខ្លះរួច) + កុំ log
- [ ] `helmet` CSP តឹងតាម app (web/admin ≠ space)
- [ ] Docker: live/api internal network តែប៉ុណ្ណោះ (មិន expose 3100 ចេញក្រៅ prod)

## 4. Definition of done
E2E អះអាងបាន៖ web token មិនអាចហៅ `/instance/*` (403) · collab token មិនអាចហៅ REST API ·
collab token របស់ doc A មិនអាចបើក doc B · localStorage គ្មាន token · refresh reuse → revoke ទាំង family ·
space response គ្មាន private field · login brute-force ជាប់ throttle។
