<div align="center">

<img src="public/icons/icon-512.png" alt="FinTrack" width="96" height="96" />

# FinTrack

**Personal finance without spreadsheets.** Zero-based budgeting, credit-card cycles,
debts, savings goals and reminders — multi-currency, bilingual, installable as a PWA.

[![CI](https://github.com/Gian-DS1/fintrack/actions/workflows/ci.yml/badge.svg)](https://github.com/Gian-DS1/fintrack/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![React 19](https://img.shields.io/badge/React-19-087ea4?logo=react&logoColor=white)](https://react.dev)
[![Vite 8](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)](https://vite.dev)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3ecf8e?logo=supabase&logoColor=white)](https://supabase.com)
[![Tailwind CSS v4](https://img.shields.io/badge/Tailwind-v4-06b6d4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)

[**Live app**](https://fintrack-rd.vercel.app) · [Screenshots](#-screenshots) · [Architecture](#-architecture) · [Run it locally](#-run-it-locally)

</div>

---

<img src="docs/screenshots/dashboard.png" alt="FinTrack dashboard: liquid-wealth chart, spending donut and reminders" width="100%" />

---

## 📑 Contents

- [What it does](#-what-it-does)
- [Screenshots](#-screenshots)
- [Tech stack](#-tech-stack)
- [Architecture](#-architecture)
- [Run it locally](#-run-it-locally)
- [Tests](#-tests)
- [Deployment](#-deployment-vercel)
- [Performance](#-performance)
- [Security & privacy](#-security--privacy)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ What it does

| | |
|---|---|
| **Budget** | Three progressive levels — Tracking (just log), the 50/30/20 rule, and **zero-based** (assign every unit of currency until "To Assign" hits 0). Auto-suggests envelopes from your last 3-month average and copies the previous month in one click. |
| **Transactions** | Fast entry with auto-categorization that learns from your history, plus **recurring transactions** that create themselves. Filter by search, type, category, date range and card used (including "no card" for cash); bulk actions and undo. |
| **Credit cards** | Automatic statement/payment cycles, rule-based cashback, partial payments, statement history, and a card catalog with predefined cashback. |
| **Debts** | Balances, interest, payment history linked to real transactions, avalanche strategy, and an estimated months-to-payoff. |
| **Savings & goals** | Goals with logged contributions (each one creates its own linked transaction), projected completion date, optional horizon (short/medium/long) and history with undo. |
| **Dashboard** | Bento grid built around a liquid-wealth time series you can scrub and pin, with spending donut, budget pace bar and reminders. Month selector to review the past. |
| **My Finances** | One reconciliation view over **cards**, **savings** and **debts** with a net-worth summary on top. |
| **Calendar** | Monthly view with past movements and upcoming due dates: debt installments, card payments, goals and recurring items. |
| **Settings** | Budget level, currency, language (es/en), CSV/Excel import & export, PDF statement import, and category management. |

> **Multi-currency and bilingual.** Each user picks a currency during onboarding and the whole app formats amounts with `Intl`; the UI ships in Spanish and English.

---

## 📸 Screenshots

All screenshots are generated from the real production build in **demo mode**
(sample data seeded in memory, no backend involved) — run `npm run screenshots`
to regenerate them from the current commit.

| Budget · zero-based envelopes | Transactions |
|---|---|
| <img src="docs/screenshots/budget.png" alt="Zero-based budget screen with envelopes by category" /> | <img src="docs/screenshots/transactions.png" alt="Transaction ledger with filters" /> |

| My Finances · cards, savings, debts | Calendar · upcoming due dates |
|---|---|
| <img src="docs/screenshots/finances.png" alt="My Finances screen with net-worth summary" /> | <img src="docs/screenshots/calendar.png" alt="Calendar with movements and upcoming due dates" /> |

<details>
<summary><b>Landing page and mobile view</b></summary>

<p align="center">
  <img src="docs/screenshots/landing.png" alt="FinTrack landing page" width="70%" />
</p>

<p align="center">
  <img src="docs/screenshots/dashboard-mobile.png" alt="FinTrack dashboard on a phone-sized viewport" width="32%" />
</p>

</details>

---

## 🧱 Tech stack

| Layer | Technology |
|------|-----------|
| Frontend | React 19 + Vite 8 (Rolldown), installable **PWA** (`manifest.webmanifest` + iOS meta tags) |
| Routing | React Router v7 with **route-level code splitting** (`React.lazy` per screen) |
| State | Zustand 5 (data cached in `sessionStorage`; the Supabase session lives in `localStorage` so it survives browser restarts) |
| Backend / Data | Supabase (PostgreSQL + Auth + RLS; OAuth uses the **PKCE** flow) |
| Styling | Tailwind CSS v4 (`@theme` tokens, dark "Stitch" periwinkle theme) |
| Charts | Recharts (lazy — only downloaded by screens that draw charts) |
| Icons | Material Symbols (UI) + JoyPixels v10 PNGs from jsDelivr (category emojis; the unicode→codepoint mapping is local, see `src/stitch/emojiCodepoint.js` — no runtime emoji library) |
| Animation | Framer Motion |
| Serverless | Vercel functions (`/api/parse-pdf` imports statements; `/api/feedback` receives feedback; `/api/cron/card-reminders` emails credit-card payment reminders on a daily cron) |
| Tests | Vitest (unit) + Playwright (E2E) |
| CI | GitHub Actions — lint, unit tests, production build and E2E on every push and PR |

---

## 🏗 Architecture

```
fintrack/
├── .github/
│   ├── workflows/ci.yml  # CI: lint · unit tests · build · E2E
│   ├── ISSUE_TEMPLATE/   # Bug report and feature request forms
│   └── dependabot.yml    # Weekly npm updates (grouped) + monthly Actions
├── api/                  # Vercel serverless functions (parse-pdf, feedback)
├── docs/
│   ├── SECURITY.md       # Security measures and design decisions
│   ├── decisions/        # Design docs and TDD evidence for the trickier features
│   └── screenshots/      # README images (regenerate: npm run screenshots)
├── public/
│   ├── manifest.webmanifest  # PWA manifest (name, icons, standalone display)
│   ├── apple-touch-icon.png  # iOS home-screen icon (180×180)
│   └── icons/                # PWA icons (192/512, maskable)
├── scripts/
│   └── screenshots.mjs   # Drives the real app in demo mode to capture the README images
├── src/
│   ├── contexts/         # AuthContext (Supabase session) · I18nContext (es/en)
│   ├── data/             # Category templates, card catalog, auto-categorization memory
│   ├── i18n/             # Translations + runtime helpers usable outside React
│   ├── lib/              # Supabase client
│   ├── stitch/           # The whole UI: shell, screens/, components, stitch.css
│   ├── stores/           # Global Zustand state (one store per domain)
│   └── utils/            # Financial calculations, formatting, card cycles, recurrence
├── supabase/
│   ├── schema.sql        # Full schema (source of truth, idempotent)
│   ├── MIGRATIONS.md     # Migration order for existing databases
│   └── *.sql             # One-off migrations + validation scripts
└── tests/                # Playwright E2E (run against the demo mode, no credentials)
```

**Conventions worth knowing**

- The UI lives entirely in `src/stitch/`. Every screen with sub-components follows a
  *thin shell + `screens/<page>/` folder* pattern, with the business logic extracted into
  **pure selectors** (`selectors.js`, `payoff.js`, `projection.js`…) that are unit-tested
  without React.
- One Zustand store per domain (`useTransactionStore`, `useDebtStore`, …), each one
  responsible for its own Supabase table and its own `sessionStorage` cache.
- Design decisions and TDD evidence for the harder features are written down in
  [`docs/decisions/`](docs/decisions).

### Database tables

`categories` · `transactions` · `budgets` · `savings` · `savings_contributions` · `debts` ·
`debt_payments` · `credit_cards` · `recurring_transactions` · `plans` *(legacy; merged into `savings`)*

> `profiles` (user preferences, e.g. budget level) is created by its own migration,
> [`supabase/add_profiles_table.sql`](supabase/add_profiles_table.sql), not by `schema.sql`.

---

## 🚀 Run it locally

### 1. Clone and install

```bash
git clone https://github.com/Gian-DS1/fintrack.git
cd fintrack
npm install
npm run dev      # http://localhost:5173
```

The app boots **without any configuration**: on `localhost` the landing page shows a
**"Ver demo"** button that seeds sample data in memory and drops you into the full app —
no Supabase project, no account, nothing written anywhere. That is the fastest way to
look around.

> The `xlsx` dependency is installed from the **official SheetJS CDN** (a maintained build,
> free of the vulnerabilities in the npm-published package). `npm install` downloads it
> automatically — it only needs access to `cdn.sheetjs.com`.

### 2. Wire up a real backend (optional)

To sign in and persist data you need your own Supabase project:

1. Create one at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** and run the full contents of [`supabase/schema.sql`](supabase/schema.sql).
   This creates the tables, enables **Row Level Security** and sets up policies and
   permissions. **It is required**: without RLS the anon key would let anyone read other
   users' data.
3. Under **Authentication → Providers**, enable **Email** (and optionally **Google**, with
   the redirect pointing at your domain / `http://localhost:5173`).
4. Copy the environment file and fill it with the values from **Supabase → Project Settings → API**:

   ```bash
   cp .env.example .env
   ```

   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=your_anon_key
   ```

> **Migrations:** a fresh database created from `schema.sql` is already complete. For an
> **existing** database that predates the redesign, run the migrations in order — see
> [`supabase/MIGRATIONS.md`](supabase/MIGRATIONS.md).
>
> The `/api` serverless functions accept **optional** variables without the `VITE_` prefix
> (they live only on the server): `WEB3FORMS_ACCESS_KEY` for the feedback form and
> `STATEMENT_SKIP_PATTERNS` for the PDF importer. The web app works without them.
> See [`.env.example`](.env.example).

### 3. Scripts

```bash
npm run dev          # development server
npm run build        # production build (dist/)
npm run preview      # preview the build
npm run lint         # ESLint
npm run test         # unit tests (Vitest)
npm run test:e2e     # end-to-end tests (Playwright)
npm run screenshots  # regenerate the README images from the current build
```

---

## 🧪 Tests

**264 unit tests** cover the financial logic and the pure UI selectors — zero-based
budgeting, accumulating sinking funds, savings capacity, card cycles and cashback,
recurrence, goal projection, debt payoff, currency formatting and the calendar:

```bash
npm run test
```

**End-to-end** flows run against the real production build with Playwright. They use the
demo mode instead of a real login, so they are deterministic and need no credentials,
no network and no access to production:

```bash
npm run test:e2e
```

Both suites, plus lint and the production build, run on every push and pull request
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

---

## ☁ Deployment (Vercel)

1. Import the repo into Vercel.
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Production + Preview).
3. [`vercel.json`](vercel.json) already configures the SPA rewrite (excluding `/api`),
   security headers/CSP, and the cache policy (immutable hashed assets; PWA
   manifest/icons for 24 h; HTML never cached).

### Install on iPhone (PWA)

Open the production URL in **Safari** → **Share → Add to Home Screen**. The app opens
full-screen with its own dark icon and a status bar matching the app background.
Sign-in (email or **Google**) persists across launches: the Supabase session lives in
`localStorage` with automatic token refresh. Google OAuth uses the **PKCE** flow, which
survives the iOS standalone-app browser handoff.

---

## ⚡ Performance

- **Route-level code splitting:** each screen is a `React.lazy` chunk, so the initial
  bundle only carries the shell (~62 kB of app code vs ~1.5 MB before the split). Heavy
  vendors (`recharts`, `framer-motion`, `@supabase`, React) ship as separate long-cached
  chunks, and `xlsx`/`papaparse` only download when you import or export files.
- **Fonts:** Inter/Manrope/Material Symbols start downloading from `index.html` in
  parallel with the JS bundle.
- **Preconnects:** to Google Fonts, jsDelivr (emoji PNGs) and the Supabase project
  (injected at runtime from the env), so the first data fetch skips DNS+TLS latency.

---

## 🔒 Security & privacy

- **Data isolation via RLS.** Every query filters by `user_id`, and the database enforces
  it with Row Level Security (`auth.uid() = user_id`). Running `supabase/schema.sql`
  sets this up.
- **Secrets.** `.env` is in `.gitignore` and never committed. The `anon key` is public by
  design (safe thanks to RLS).
- **Local cache.** For speed, financial data is cached in `sessionStorage` (cleared when
  the browser closes); only the Supabase session token lives in `localStorage`. Signing
  out clears every cache.
- **Demo mode is localhost-only.** It seeds data without authentication, so it is gated
  behind a hostname check and never reaches the public deployment.
- **Feedback.** The Feedback page sends messages to the developer's inbox through the
  external **Web3Forms** service; it stores nothing in your database.

Full write-up in [`docs/SECURITY.md`](docs/SECURITY.md).

---

## 🤝 Contributing

Issues and pull requests are welcome. [`CONTRIBUTING.md`](CONTRIBUTING.md) covers
how to get the app running (no backend needed — the demo mode is enough), what the
code expects from a change, and the conventions that matter: pure selectors for
anything that computes money, one Zustand store per domain, both `es` and `en`
strings for every new label, and an RLS policy for every new table.

Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md). Found a
vulnerability? Don't open a public issue — use a
[private advisory](https://github.com/Gian-DS1/fintrack/security/advisories/new).

---

## 📄 License

[MIT](LICENSE) © Giancarlos Estévez
