# Security — FinTrack

A summary of the app's security measures and design decisions. Useful for audits
and for understanding why certain configurations are intentional.

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately through a
[GitHub security advisory](https://github.com/Gian-DS1/fintrack/security/advisories/new).

Include what you found, how to reproduce it, and what an attacker could reach with
it. You will get a first reply within a few days; if the issue is confirmed, the
fix ships to production before any public write-up.

**In scope:** the deployed app at `fintrack-rd.vercel.app`, this repository, the
`/api` serverless functions, and the RLS policies in `supabase/schema.sql` — in
particular anything that lets one user read or write another user's data.

**Out of scope:** the demo mode (localhost-only by design, seeds fake data without
auth), the `anon key` being public (that is intentional and safe under RLS — see
below), reports from automated scanners with no working proof of concept, and
vulnerabilities in Supabase or Vercel themselves (report those upstream).

Only the deployed version of `main` is supported; there are no maintained older
releases.

## HTTP headers (vercel.json)

Applied at the Vercel edge to every response:

| Header | Value | Purpose |
|----------|-------|-----------|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Forces HTTPS |
| `X-Frame-Options` | `DENY` | Anti-clickjacking (legacy) |
| `Content-Security-Policy` | see below | Restricts resource origins |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits referrer leakage |
| `Permissions-Policy` | camera/mic/geo/payment/usb/cohort disabled | Restricts browser APIs |
| `Cross-Origin-Opener-Policy` | `same-origin` | Isolates the browsing context |
| `Cross-Origin-Resource-Policy` | `same-origin` | Prevents other origins from reading resources |
| `Access-Control-Allow-Origin` | the app's own domain (not `*`) | CORS not wide open |

### Cache
- **HTML / SPA routes**: `no-store, no-cache, must-revalidate`. Authentication
  pages and sensitive data are never cached in the browser or proxies.
- **`/assets/*`** (JS/CSS with content hashes): `public, max-age=31536000, immutable`.
  Safe because the hash changes whenever the content changes.
- **PWA assets** (`manifest.webmanifest`, `apple-touch-icon.png`, `favicon.svg`,
  `/icons/*`): `public, max-age=86400`. They contain nothing sensitive and change
  rarely; 24h keeps icon updates reasonably fresh.

### CSP — note on `'unsafe-inline'` in styles (INTENTIONAL)
`script-src` is strict (`'self'`, **without** `'unsafe-inline'`) — this is the
important XSS vector and it is closed.

`style-src` keeps `'unsafe-inline'` on purpose. Removing it is not viable in this
static SPA:
- `react-hot-toast` uses **goober** (CSS-in-JS), which injects a `<style>` at runtime.
- 30+ components use `style=` attributes (React + framer-motion + recharts), which
  do not accept a nonce.
- Generating per-request nonces would require SSR; the app is static on Vercel.

The residual risk is low: CSS does not execute JavaScript. If the app later moves
to SSR or removes goober, `style-src-elem` can be hardened.

### CSP — `img-src` includes `https://cdn.jsdelivr.net`
The category emojis are JoyPixels PNGs served from jsDelivr (see
`src/stitch/Emoji.jsx`). Only images can load from that origin — scripts and
styles from jsDelivr remain blocked.

## Data (Supabase)
- **Row Level Security enabled** on every table (`supabase/schema.sql`), with a
  "only my rows" policy (`auth.uid() = user_id`) for authenticated users.
- The `anon` role has no privileges over the data tables.
- The client uses the **anon key** (public by design); the real protection is RLS.
- **Session in `localStorage`** (intentional): the session must survive browser
  restarts — including the installed iOS PWA — until the user signs out manually;
  the refresh token rotates automatically. Financial data caches (Zustand stores)
  live in `sessionStorage` instead, so no financial information stays on disk
  between browser sessions; every session end (manual sign-out, token expiry,
  sign-out from another tab) clears them (`clearUserData`).
- **OAuth uses PKCE** (`flowType: 'pkce'` in `src/lib/supabase.js`): the callback
  returns an authorization `?code=` instead of tokens in the URL fragment, so
  access/refresh tokens never touch the URL, browser history, or referrers — and
  the flow survives the iOS standalone-PWA browser handoff.

## Backend (api/)
- `api/parse-pdf.js`: requires a valid **Bearer token** (verified against Supabase),
  limits the PDF size (~6MB, anti-DoS), sanitizes the extracted text, and returns
  **generic errors** to the client (the detail only goes to the server logs).
- `api/ingest.js` (automatic expense logging): called by iOS Shortcuts and mail
  scripts, which cannot hold a Supabase session, so it authenticates with a
  **personal ingest token** instead.
  - Tokens are generated in the browser (256 bits), shown once, and only their
    **SHA-256** is stored (`ingest_tokens`). Clients can list, create and delete
    their own rows; there is no `UPDATE` grant.
  - **Write-only scope:** a token can create expenses; the endpoint never returns
    user data beyond an echo of what it just stored.
  - Runs with the `service_role` key, so it **fails closed** (503) when the key is
    missing and scopes every query to the `user_id` resolved from the token.
  - The single write path is the SQL function `ingest_transaction`
    (`SECURITY INVOKER`, executable by `service_role` only): atomic
    cross-channel deduplication under a per-user advisory lock and a cap of 60
    automatic entries per hour.
  - Email bodies are parsed in memory and are **neither stored nor logged**.
  - Design rationale: [`docs/decisions/2026-11-17-registro-automatico.md`](decisions/2026-11-17-registro-automatico.md).

## Secrets
- `.env` is in `.gitignore`; only `.env.example` is versioned (without real values).
- Variables with the `VITE_` prefix are exposed to the client (only the Supabase URL
  and anon key, which are public). Everything else is server-only.

## Google sign-in — branding on the consent screen

When signing in with Google, the consent screen used to show Supabase's raw
subdomain (`<ref>.supabase.co`) instead of the app's brand. This is NOT fixed in
the code (`signInWithOAuth` in `src/contexts/AuthContext.jsx` only controls the
`redirectTo` on the way back). It is configured in the Google Cloud Console.

### Show "FinTrack" + logo (free, no custom domain)
1. [console.cloud.google.com](https://console.cloud.google.com) → select the
   project where the OAuth credentials live (the one with the Client ID configured
   in Supabase → Authentication → Providers → Google).
2. **APIs & Services → OAuth consent screen → Branding**:
   - App name: `FinTrack`
   - User support email + Developer contact email
   - App logo: upload the logo (square, ≤1MB) — optional
   - Authorized domains: `vercel.app` (or your own domain once you have one)
3. Save. The screen now reads "FinTrack wants to access…".

**Notes:**
- The **name** change applies immediately and does not require verification with the
  basic login scope (email/profile).
- Uploading a **logo** can trigger Google verification (days/weeks). The name alone
  usually goes through directly.
- In "Testing" mode there is no verification but it is limited to 100 users;
  "Production" with basic scopes normally goes through directly.

### Show your own domain in the callback (requires a custom domain + payment)
To make `auth.yourdomain.do` appear instead of `<ref>.supabase.co`:
1. Register your own domain.
2. Supabase → Custom Domains (paid add-on, ~$10/mo): add `auth.yourdomain.do`
   and configure the CNAME in DNS.
3. Update the callback in the Google Cloud Console to
   `https://auth.yourdomain.do/auth/v1/callback`.

> Note: with the free `*.vercel.app` subdomain this is not possible (you do not
> control `vercel.app`'s DNS). Pending until a custom domain is registered.
