# Personal Life Tracker

A manual-first, privacy-respecting life tracker that combines **personal finance**,
**health & wellbeing logging**, a witty **Wallet Roast Mode**, and **insights** —
built with React + TypeScript + Vite and styled to match the supplied
*improved UI* design package.

> **Honest status:** Two persistence modes now exist behind one `Repository`
> interface. **Local mode** stores everything in your browser via IndexedDB.
> **Account mode** adds a real FastAPI + PostgreSQL backend whose identity layer is
> **Firebase Authentication** (email/password with Firebase's own verification emails,
> plus Sign in with Google). The backend **verifies Firebase ID tokens with the Admin
> SDK**, then mints its **own** HttpOnly session cookie + CSRF token for per-user data
> isolation. The backend, its migrations and both auth and
> cross-user-isolation behaviour are covered by an automated test suite — see
> [Backend & authentication](#backend--authentication) and
> [What is real vs. not](#what-is-real-vs-not) for exactly what is verified and what
> still requires you to test against a live stack. There is still **no**
> bank/UPI/payment aggregation or wearable integration, and none is faked. An
> **optional** read-only AI assistant (`/assistant`) ships behind explicit consent and
> stays disabled until you configure a model provider — see
> [Read-only assistant (AI chat)](#read-only-assistant-ai-chat).

---

## Table of contents

- [Storage modes](#storage-modes)
- [Quick start](#quick-start)
- [Scripts](#scripts)
- [What is real vs. not](#what-is-real-vs-not)
- [Feature map](#feature-map)
- [Architecture](#architecture)
- [Domain rules (the important parts)](#domain-rules-the-important-parts)
- [Design system](#design-system)
- [Testing](#testing)
- [Backend & authentication](#backend--authentication)
- [Read-only assistant (AI chat)](#read-only-assistant-ai-chat)
- [Project layout](#project-layout)

---

## Storage modes

The persistence boundary is a single `Repository` interface (`src/repo/`), and two
implementations satisfy it:

- **`localRepository`** (`src/repo/local.ts`) — IndexedDB. Zero infrastructure; the
  SPA runs entirely on-device. Used by the frontend test suite.
- **`remoteRepository`** (`src/repo/remote.ts`) — talks to the FastAPI backend over
  `/api` using HttpOnly session cookies + a CSRF token. This is what the app boots
  with once you run the backend. Because the store only ever calls the repository
  interface, no screen or domain module changed when adding the backend.

Records keep their **stable domain ids** (e.g. `cat-food`, `tx-…`) as a per-user
`external_id`; the database uses its own UUID primary key. Ownership is the tuple
`(user_id, collection, external_id)`, so two users may reuse the same domain id
without ever seeing or overwriting each other's rows.

## Quick start

### Frontend only (local mode)

Requirements: **Node 18+** (developed on Node 22) and npm. No database or Docker
is needed for local mode.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check (tsc --noEmit) then bundle to dist/
npm run preview    # serve the built dist/
npm test           # vitest run
```

> **PowerShell note (Windows):** if `npm` is blocked by execution policy, call the
> cmd shim directly, e.g. `& "C:\Program Files\nodejs\npm.cmd" install`.

### Full stack (account mode: auth + PostgreSQL + email capture)

Requires **Docker Compose**. This starts PostgreSQL, the FastAPI API (which runs
Alembic migrations before serving), Mailpit (local email capture at
<http://localhost:8025>) and the Vite dev server.

```bash
cp .env.example .env
cp backend/.env.example backend/.env

docker compose up --build
# frontend http://localhost:5173 · API http://localhost:8000/api · Mailpit http://localhost:8025
```

The frontend proxies every `/api` request to the backend (see `vite.config.ts`), so
session cookies and CSRF stay **same-origin** in the browser. Sign-up and sign-in go
through **Firebase**: choose **Create account** (or **Continue with Google**). After a
password sign-up Firebase sends its own verification email — you land on a **Confirm
your email** screen and cannot reach protected features until the address is verified,
because the backend only mints a session for a **server-verified** Firebase token.
You'll need the Firebase web config in `.env` and a Firebase project (see
[Firebase setup](#firebase-authentication-setup)).

On first launch you'll see the **Onboarding** flow (currency, timezone, expected
monthly salary, first budgets). The app starts empty and is filled only by data you
record — there is **no demo/sample data** to load.

## Scripts

| Script              | Command                     | What it does                                  |
| ------------------- | --------------------------- | --------------------------------------------- |
| `npm run dev`       | `vite`                      | Dev server with HMR on port 5173.             |
| `npm run build`     | `tsc --noEmit && vite build`| Full type-check, then production bundle.      |
| `npm run preview`   | `vite preview`              | Serve the built `dist/` locally.              |
| `npm run typecheck` | `tsc --noEmit`              | Type-check only.                              |
| `npm test`          | `vitest run`                | Run all tests once.                           |
| `npm run test:watch`| `vitest`                    | Watch mode.                                   |

## What is real vs. not

**Real & implemented**

- Manual transaction / salary / allocation / budget CRUD with correct,
  deterministic integer minor-unit math (no floats).
- Persisted state that survives refresh (IndexedDB), behind a repository interface.
- Wallet Roast Mode: validated ascending thresholds, essential-category exemptions,
  idempotent event keys (no duplicate crossings), deterministic witty copy.
- Health logging: daily wellbeing, symptoms, medication, measurements — private,
  respectful, **never** auto-attributing causes, and missing values are **never**
  coerced to zero.
- Insights computed only from real records, with ranges, sample-size context, empty
  states, and CSV export. No fabricated numbers to fill a chart.
- Settings & Privacy center: currency, timezone, reminders, category management,
  full CSV export, demo reset, and delete-all.
- Onboarding, demo-data isolation, responsive layout (desktop sidebar / mobile bottom
  nav), reduced-motion support, keyboard-focus and ARIA labelling.

**Real & implemented (backend / account mode)**

- FastAPI + SQLAlchemy + Alembic over PostgreSQL; migrations run on startup — the
  app never assumes tables exist.
- Email + Argon2id-password authentication with HttpOnly, SameSite session cookies
  (tokens are **never** stored in `localStorage`), double-submit CSRF for cookie
  sessions, and per-request rate limiting.
- Email verification, resend-verification, forgot-password and reset-password flows
  with **hashed, single-use, expiring, purpose-scoped** tokens; login / forgot / resend
  responses are uniform so they don't leak whether an account exists. A verification
  token cannot reset a password (and vice-versa), and resending issues a fresh link
  that supersedes the previous one.
- Provider-agnostic email delivery (`app/core/mail.py` + `app/core/email_templates.py`):
  `EMAIL_PROVIDER=mailpit|smtp` uses an SMTP adapter (Mailpit locally); `EMAIL_PROVIDER=resend`
  uses the Resend HTTPS API via `httpx` for real inboxes. A delivery failure is surfaced
  honestly — the register response reports `verificationEmailSent` + the active
  `provider`, and the app never claims mail arrived when it did not. Branded, responsive
  HTML emails ship with a plain-text alternative.
- Per-user data isolation enforced in the database (ownership = user + collection +
  external id); import, CRUD and reset are all scoped to the authenticated user.
- Sessions are revoked on logout and on any password change or successful reset.
- A consent-gated path to import a browser's local IndexedDB data into the account,
  with demo records excluded unless the user explicitly opts in.
- Production config is validated at startup: refuses to boot with a default secret,
  insecure cookies, `mailpit` (or a `localhost`) SMTP host, a non-Postgres DB, a
  non-https origin, an un-verified `EMAIL_FROM`, login-before-verification enabled, or
  `EMAIL_PROVIDER=resend` without a `RESEND_API_KEY`.

**Explicitly NOT implemented (and not faked)**

- Bank / UPI / card / payment-app connections of any kind.
- Wearable / health-device ingestion (steps, sleep, heart rate from devices).
- A "life balance score" or any fictional aggregate metric.
- Background / push notifications. In-app reminders only appear while the tab is open.
- Encrypted cloud backup or at-rest encryption beyond PostgreSQL defaults; none is
  claimed.
- OAuth / social login, 2FA, or account recovery by anything other than email.

## Feature map

| Area           | Route        | Highlights                                                            |
| -------------- | ------------ | --------------------------------------------------------------------- |
| Onboarding     | first run    | Currency, timezone, expected salary, starter budgets; sets `onboarded`. |
| Overview       | `/`          | Month greeting, budget progress, spend vs plan, recent activity, roast. |
| Money          | `/money`     | Add transactions, salary receipts, allocations, budgets, filters, CSV. |
| Health         | `/health`    | Wellbeing logs, symptoms, medication, measurements; empty states.      |
| Wallet Roast   | `/roast`     | Thresholds, intensity, exclusions, quiet hours, live preview, history. |
| Insights       | `/insights`  | Category donut, monthly trend, weekday pattern, health summary, export.|
| Assistant      | `/assistant` | Read-only AI chat over **your own** records; consent-gated, grounded, validated. Optional (off until a provider is configured). |
| Settings       | `/settings`  | Preferences, categories, reminders, privacy & data controls.           |

## Architecture

```
React SPA (Vite + TS)
  pages/            Route-level screens (Overview, Money, Health, Roast, Insights, Settings, Onboarding)
  components/       UI primitives, layout shell, charts, forms, icons
  state/            AppProvider context (snapshot-in-memory + write-through), month & money hooks
  domain/           Pure, framework-free logic: types, money, finance, roast, date, categories, schemas
  repo/             Persistence boundary: Repository interface + localRepository (IndexedDB via idb)
  lib/              csv export, class-name helper
```

The **domain layer is pure and unit-tested** — money arithmetic, finance accounting,
roast thresholds and message selection, and date handling have zero React/DOM
dependencies. The **repository layer** is the only place that touches storage.

```
UI  ──▶  state/store (AppProvider)  ──▶  domain/* (pure math & rules)
                     │
                     └──▶  repo/local (Repository)  ──▶  IndexedDB
```

To add a backend, implement the `Repository` interface against HTTP endpoints and
swap the single `localRepository` reference — no screen or domain changes required.

## Domain rules (the important parts)

**Money — integer minor units.** Every amount is stored as an integer in minor
units (₹1 = 100 paise; JPY has a 1:1 scale). `parseToMinor` / `formatMoney` /
`sumMinor` never accumulate float error; refunds net against the same category and
the category net is floored at 0.

**Accounting distinctions** (`src/domain/finance.ts`):

- **Planned ≠ actual.** Allocations are plans; transactions are what actually
  happened. A budget line never inflates "spent".
- **Consumption ≠ transfer ≠ investment.** Savings transfers and investment (SIP)
  contributions are tracked separately and are **not** counted as spending.
- **Salary vs other income** are separated; salary-category income transactions are
  not double-counted as "other income".
- **Unallocated / oversubscribed** = money-in minus planned allocations.

**Roast rules** (`src/domain/roast.ts`): thresholds must be whole numbers within
`50%–300%`, unique and strictly ascending; essential categories (rent, food, health,
bills, family) are never roasted; each crossing is idempotent via
`eventKey = scope:month:scopeId:threshold`; copy is witty, never cruel, and never
mocks essentials.

**Health rules:** triggers are user-suspected only — the app never claims causation;
missing measurement values stay null (never auto-zeroed); no diagnoses are produced.

## Design system

Re-implemented in React from the provided design package — no iframes, no embedded
screenshots. Locked dark, premium fintech/wellness aesthetic:

- **Surfaces:** deep navy scale (`bg / surface / raised / lowest / line`).
- **Accents:** lime `#B7F774`, violet `#9B8AFB`, coral `#FF9EAE` (each with an
  `on-*` foreground variant for contrast).
- **Type:** Plus Jakarta Sans (display) + Inter (body); tabular `nums` for figures.
- **Glass cards**, restrained shadows, purposeful entrance/interaction animation.
- **Accessibility:** respects `prefers-reduced-motion` (and a manual toggle that adds
  a `.reduce-motion` class), visible focus rings, ARIA roles on interactive widgets.
- **Responsive:** persistent sidebar on desktop, bottom navigation on mobile; tested
  against 320 / 375 / 430 / 768 / 1280 / 1440 px breakpoints via Tailwind config.

Tokens live as CSS variables in `src/index.css` and are mapped to Tailwind in
`tailwind.config.js`.

## Testing

`npm test` runs Vitest (+ jsdom + Testing Library) with a fake IndexedDB shim so the
real repository code is exercised. The current suite is **90 tests across 11 files**:

- `domain/money.test.ts` — parsing, formatting, grouping, rounding, JPY scale, NaN
  guards, truncation, percentages.
- `domain/finance.test.ts` — salary/other-income separation, refund netting &
  flooring, transfers/investments excluded from spending, unallocated/oversubscribed,
  budget usage, month scoping, trend.
- `domain/roast.test.ts` — threshold validation, eligibility & exemptions,
  `highestCrossed`, idempotent `eventKey`, deterministic messages.
- `domain/date.test.ts` — year-month derivation, cross-year arithmetic, ranges,
  leap-year days, formatting.
- `domain/schemas.test.ts` — Zod validation for transactions, salary, allocation,
  health and measurement inputs.
- `repo/local.test.ts` — init seeding & idempotency, write-through persistence,
  demo-flag preservation, remove/removeMany, KV updates, `clearData`.
- `components/ui/primitives.test.tsx` — Button/Toggle/Segmented/Field/Progress/Chip/
  EmptyState/ConfirmDialog rendering and interaction (accessible names, ARIA, events).
- `pages/Login.test.tsx` — confirm-password + minimum-length validation block submit,
  a successful registration routes to `/check-email`, and a 403 (unverified) sign-in
  routes to `/check-email`.
- `pages/VerifyEmail.test.tsx` — the token is not consumed until the user confirms;
  verify → success and the token is stripped from the URL; failed/expired and missing
  tokens both render the invalid state (and a missing token never calls the API).
- `pages/CheckEmail.test.tsx` — masked address, the Mailpit-vs-real provider hint, the
  delivery-failure and unverified banners, the resend action, and the email-entry state.
- `pages/Assistant.test.tsx` — the not-configured state never fakes an answer, the
  consent gate blocks the composer until informed consent is given (and posts it), the
  five starter questions appear once consented, and a submitted question runs through
  the client pipeline to render the validated, disclaimer-bearing answer.

Build verification: `npm run build` performs a full `tsc --noEmit` type-check and a
successful Vite production bundle.

### Backend tests

The backend uses portable SQLAlchemy types, so the suite runs on in-memory SQLite
while production targets PostgreSQL.

```bash
cd backend
python -m venv venv
venv\Scripts\python -m pip install -r requirements.txt
venv\Scripts\python -m pytest
```

**48 backend tests** cover: registration + settings created only after a valid user,
login/logout, email verification, resend-verification, forgot/reset with token
**expiry** and **single-use**, session expiry, password change revoking all sessions,
production-config validation, and **cross-user isolation** — two different users
attempting to read, modify, delete or import each other's records (all denied), plus
that replacing a collection never resurrects deleted rows. The email work added
**provider adapters** (`test_email_providers.py` — SMTP/Mailpit multipart + the Resend
HTTP payload, including a failing-provider path) and **verification enforcement**
(`test_verification_enforcement.py` — login rejected with 403 until verified, resend
supersedes the prior token, and a verification token cannot reset a password or
vice-versa).

Migration check (no Docker needed): `venv\Scripts\python -m alembic upgrade head`
against a scratch SQLite DB creates all tables (`users`, `account_settings`,
`sessions`, `auth_tokens`, `records`) cleanly.

### Assistant (chatbot) tests

The read-only assistant ships **65 pytest tests** in `chatagent/chatbot/tests/`,
discovered by the same runner (`pytest.ini` at the repo root adds both
`backend/tests` and `chatagent/chatbot/tests` to `testpaths`). **No live model
call is made** — a deterministic mock provider stands in, so the suite runs
offline. Run everything (backend + assistant) from the repo root with
`backend\venv\Scripts\python -m pytest` (**113 tests total**).

- `test_providers.py` — provider inference from `LLM_BASE_URL` (Gemini /
  OpenRouter / xAI only; unknown hosts rejected), URL normalisation, and honest
  error mapping (auth / rate-limit / unsupported / malformed / connection) with
  no key leakage.
- `test_context.py` — finance + health fact builders reproduce the TypeScript
  domain math (salary, net spending, budget usage, category spend, period
  comparison, symptom frequency, medication status, measurement trend) and are
  strictly user-scoped.
- `test_policy.py` / `test_output_validation.py` — prohibited-intent refusals,
  conservative clarification of unrecognised questions, and grounding checks that
  reject any number/percentage/date or professional advice not backed by an
  authoritative fact.
- `test_chat_api.py` — the full pipeline behind `POST /api/chat/...`: the consent
  gate blocks before any generation; prohibited questions never reach the model;
  an ungrounded draft is retried once then falls back to a safe message (never
  stored); a provider failure is reported honestly with the user message preserved
  for retry; size/daily limits and the key-free status endpoint.
- `test_ownership.py` — user B cannot read, rename, delete, export or wipe user
  A's threads/messages; anonymous requests get 401.
- `test_retention.py` — per-user retention (30/90/365) ages out old messages while
  "keep until deleted" retains everything, and deletion is per-user.

`backend\venv\Scripts\python -m alembic upgrade head` also creates the assistant
tables (`chat_threads`, `chat_messages`, `chat_settings`) — verified against a
scratch SQLite DB, and `alembic check` reports no model/migration drift.

## Backend & authentication

The backend lives in `backend/`. The browser auth flows live in
`src/lib/{firebase.ts,firebaseAuth.ts}`,
`src/pages/{Login,CheckEmail,ForgotPassword,ResetPassword}.tsx`,
`src/state/auth.tsx`, `src/api/` and `src/repo/remote.ts`. Identity is Firebase's:
email/password (Firebase `createUserWithEmailAndPassword` + `sendEmailVerification`)
and Google (`signInWithPopup`). Every successful Firebase sign-in sends its **ID
token** to `POST /api/auth/firebase`, where the backend verifies it with the
**Firebase Admin SDK** and mints the app's own session — the browser never asserts its
own verified/identity status. `/check-email` is the verification-pending screen.
The app boots through an
auth **Gate** (`src/App.tsx`) that distinguishes four states — `checking`, `authed`,
`anon` (401) and `unreachable` — so a **backend outage is shown as a connectivity
error, never silently redirected to the login page**.

**Running it end to end**

```bash
docker compose up --build   # Postgres + API (auto-migrates) + Mailpit + Vite
```

- Sign up at <http://localhost:5173> with **Create account** or **Continue with
  Google**. A password sign-up triggers **Firebase's own verification email**; you land
  on the **Confirm your email** screen with a resend action.
- **No app session is issued until Firebase reports the email verified.** `POST
  /api/auth/firebase` returns `403 email_not_verified` for an unverified token, and the
  browser turns that into the pending screen. `ALLOW_LOGIN_UNVERIFIED` applies only to
  the legacy DB-password `/login` path; its safe default is **`false`** everywhere (and
  it is enforced `false` in production), so an unverified account can never obtain a
  session.
- The **Account** card in Settings lets you change your password (which revokes all
  sessions) and import this browser's local data (consent-gated).

### Firebase Authentication setup

Project id: `lifetracker-0703` (**Email/Password** and **Google** enabled in the
Firebase Console → Authentication → Sign-in method).

**Browser config** — public values, in the app-root `.env` (gitignored):

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=lifetracker-0703.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=lifetracker-0703
VITE_FIREBASE_APP_ID=...
```

**Backend config** — `backend/.env` (gitignored). The backend verifies ID tokens, so it
needs `FIREBASE_PROJECT_ID` plus Admin-SDK credentials. **A downloadable private key is
optional** — pick whichever credential method your Google Cloud policy allows:

```dotenv
FIREBASE_PROJECT_ID=lifetracker-0703

# Option 1 — a service-account JSON file (gitignored; NEVER commit it):
FIREBASE_CREDENTIALS_PATH=/absolute/path/to/serviceAccount.json

# Option 2 — Application Default Credentials (ADC): leave FIREBASE_CREDENTIALS_PATH
#   empty and provide ADC via GOOGLE_APPLICATION_CREDENTIALS, `gcloud auth
#   application-default login`, Workload Identity, or service-account impersonation.
#   Use this when policy forbids exporting keys — the Admin SDK resolves ADC itself.
```

If neither is available the `/api/auth/firebase` endpoint returns `503` (never a silent
pass), so a mis-configured backend fails loudly.

Install `firebase-admin` in the backend venv and apply the `0003_google_auth` migration
(adds `users.firebase_uid`, makes `password_hash` nullable + a unique index; runs on dev
startup, otherwise `alembic upgrade head`).

**Security policy**

- The backend trusts **only** what `verify_id_token` returns (`uid`, `email`,
  `email_verified`, provider). Any identity/verified claim supplied separately by the
  browser is ignored.
- An **unverified** email never receives a session and is **never** linked to an
  existing account.
- **Account linking** is by Firebase `uid`. An existing (legacy) row is linked only when
  Firebase proves mailbox ownership (`email_verified=true`) — never on a bare email
  match. A `uid` already bound to a different identity is rejected (`409`).
- **Only allow-listed sign-in providers may sign in, link or provision.** The backend
  accepts `password` and `google.com` (the real `firebase.sign_in_provider` claim
  values). Any other provider (`phone`, `apple.com`, federated, …) is rejected with
  `403 unsupported_provider` **before** any lookup, link or session, because we cannot
  yet vouch that those providers prove mailbox ownership. Extend the allow-list in
  `app/api/auth.py` (`_SUPPORTED_PROVIDERS`) only after reviewing a provider's claims.
- **New Firebase users are provisioned just-in-time** on first verified sign-in with no
  DB password (`password_hash=NULL`); their defaults self-heal through `/api/bootstrap`.

**Migrating existing PostgreSQL users** (data + `pk` preserved)

1. Sign in with **Google** (or a Firebase email/password account) using the **same,
   Firebase-verified email** → the backend links that `uid` to the existing row, keeping
   its id and all finance/health records.
2. For email-only users, provision a Firebase account (`create_user(email,
   email_verified=True)`, no password), then use Firebase's forgot-password to set one;
   the link-by-verified-email step then attaches the `uid`.

There is now **one** verification system — Firebase. The custom email-verification
token flow (`/verify-email`, `/resend-verification`, and the `email_verify` token) has
been removed. The legacy DB-password endpoints (`/login`, `/forgot-password`,
`/reset-password`, `/change-password`) remain only for backward compatibility, and
**`/register` returns `410` in production** so public sign-ups can only complete through
Firebase (it is still available under `ENV=test` for the migration/test path).

**Password reset** — `POST /api/auth/forgot-password` is a single **generic** endpoint
that dispatches server-side and never reveals whether an address exists:

- **Firebase identities** (a row already linked by `uid`, or a Firebase account our DB
  has not seen yet) are reset through the **Admin SDK** `send_password_reset_email`,
  which deep-links back to `/login`. Because the lookup is server-side, behaviour does
  **not** depend on the project's *email-enumeration-protection* setting, and the client
  always receives the same response.
- **Legacy DB-password accounts** (Firebase has no such user) fall back to the existing
  single-use token link at `/reset-password`.
- A **Firebase-only** account has no DB password, so the Settings “Account” card shows
  **Email password-reset link** instead of an in-app change form; `require_reauth` and
  `/change-password` reject it (`403`) — the emailed Firebase link is the correct path.

> ℹ️ The reset endpoint relies on the **Admin** SDK (server), not the browser's
> `sendPasswordResetEmail`, precisely to keep the response generic and enumeration-safe.
> A Firebase account that has **never** completed a token exchange (no row in our DB yet)
> is still covered, because the Admin lookup queries Firebase directly.

**Choosing an email provider**

- **Mailpit (default, dev):** `EMAIL_PROVIDER=mailpit` — mail is captured locally and
  never leaves your machine; nothing reaches a real inbox. Inspect it at
  <http://localhost:8025>.
- **Resend (free tier, real inboxes):** set `EMAIL_PROVIDER=resend`, a `RESEND_API_KEY`,
  and a verified `EMAIL_FROM` on your Resend domain. Delivery goes out over the Resend
  HTTPS API (`httpx`); the key stays server-side and is never sent to the browser.
- **Any other SMTP relay:** set `EMAIL_PROVIDER=smtp` with `SMTP_HOST`/`SMTP_PORT`
  (+ `SMTP_USER`/`SMTP_PASSWORD`/`SMTP_USE_TLS` as needed) and a real `EMAIL_FROM`.

**Verification status — what is proven here vs. what you must check**

| Behaviour | Status |
| --- | --- |
| Auth, tokens (expiry + single-use), session revocation, logout | ✅ Verified by `pytest` (in-memory SQLite) |
| Firebase `/auth/firebase`: valid/invalid token, verify-gate, JIT create, safe linking (id + records preserved), CSRF, cross-user isolation | ✅ Verified by `pytest` (`verify_firebase_token` mocked) |
| Provider allow-list (`password`/`google.com` only; others `403` and cannot link) | ✅ Verified by `pytest` (`verify_firebase_token` mocked) |
| Firebase browser flows: token exchange, `403 → VerificationRequiredError`, Google + cancel, resend | ✅ Verified by `vitest` (SDK mocked) |
| `0003_google_auth` migration (`firebase_uid` + nullable `password_hash` + unique index) | ✅ Verified (`alembic upgrade head` on SQLite) |
| Cross-user read/modify/delete/import isolation | ✅ Verified by `pytest` |
| Production config rejects insecure defaults | ✅ Verified by `pytest` |
| Alembic migration creates all tables | ✅ Verified (`alembic upgrade head` on SQLite) |
| Frontend type-check + production bundle | ✅ Verified (`tsc --noEmit`, `vite build`) |
| Frontend unit/component tests (107, incl. Firebase auth flows + verification gate + Assistant consent/gate/pipeline) | ✅ Verified (`vitest run`) |
| Assistant: providers, context math, policy, output validation, chat API, cross-user ownership, retention (65) | ✅ Verified by `pytest` (mock provider; no live network) |
| Assistant Alembic migration (`chat_threads`/`chat_messages`/`chat_settings`) + no model drift | ✅ Verified (`alembic upgrade head`, `alembic check` on SQLite) |
| Real model provider call (Gemini / OpenRouter / xAI) | ⚠️ Wired via `httpx`; **not** exercised against a live provider here — set `LLM_*` and test end-to-end |
| Email provider adapters (SMTP + Resend payloads) | ✅ Verified by `pytest` (mocked transport; no live network) |
| Legacy password-reset token expiry + single-use + purpose isolation; session expiry/revocation | ✅ Verified by `pytest` |
| Password-reset dispatch (Firebase via Admin SDK vs legacy token; Firebase-only never gets a legacy link; generic, enumeration-safe response) | ✅ Verified by `pytest` (`firebase.send_password_reset_email` mocked) |
| Legacy `/register` returns `410` in production, works under `ENV=test` | ✅ Verified by `pytest` |
| Live Firebase project `lifetracker-0703`: real ID-token verification, Google popup, delivered verification emails | ⚠️ Wired via `firebase-admin` + the Firebase JS SDK; **not** exercised against the live project here — set the `.env` values + credentials and test end-to-end |
| Real Postgres behaviour (JSONB, unique constraints under concurrency) | ⚠️ Code is portable but **not exercised against a live Postgres here** — run `docker compose up` to verify |
| Actual email delivery | ⚠️ Default path is captured locally by **Mailpit**; the **Resend** / real-SMTP path is unit-tested against mocked transports but **not** exercised against a live provider here — configure credentials and send a real message to confirm |
| Cookies + CSRF through the Vite proxy in a real browser | ⚠️ Implemented and unit-consistent; **needs manual end-to-end check** (`docker compose up`, sign up + log in) |
| Rate limiting under load; HTTPS/TLS termination | ⚠️ Wired up (`slowapi`, config) but **not load-tested / not run behind TLS here** |

No "production-ready security" claim is made: this stack has not been
penetration-tested, and every ⚠️ row must be verified against a live deployment
before real use.

## Read-only assistant (AI chat)

An **optional**, consent-gated assistant at `/assistant` that answers questions
about **the signed-in user's own** financial and health records. It is deliberately
narrow and honest:

- **Deterministic facts, model-written prose.** Trusted backend functions compute
every number (integer minor units, the same rules as `src/domain/finance.ts`), and
the LLM only phrases those facts. The model never runs SQL, never computes an
authoritative value, and cannot ask for data outside the routed intent.
- **Grounded + validated before delivery.** Answers are produced as strict JSON,
Pydantic-validated, then re-checked: any currency/percentage/count/date that is not
an authoritative fact (or an explicitly derived one), and any professional advice,
is rejected. On failure it retries once with a stricter prompt and otherwise returns
a safe message — a rejected draft is **never** shown. There is **no streaming** and
**no silent fallback** to made-up data.
- **Refusal-first scope.** Out-of-the-box it declines: earning-more / career /
salary-negotiation advice, which investments/stocks/SIPs/funds to pick, loan /
insurance / tax / legal advice, medical diagnosis, medication safety, dosage or
treatment, general knowledge, and any request to modify, pay or act. Guardrails are
layered (prohibited-pattern refusal → allowed-intent allowlist → conservative
clarification); a single keyword blocklist or an LLM classifier is **never** treated
as the security boundary, and an unrecognised or ambiguous question retrieves no data.

### Enabling it (server-side only)

The assistant is **off until three environment variables are set in
`backend/.env`** (never in the frontend). Until then `/api/chat/status` reports
`configured: false` and the page explains that it isn't set up — it does not fake
answers.

```dotenv
LLM_MODEL=<model id>
LLM_BASE_URL=<one of the supported OpenAI-compatible base URLs below>
LLM_API_KEY=<secret; server-side only, never returned to the client, never logged>
```

The provider is **inferred from `LLM_BASE_URL`**; only these are accepted (anything
else is rejected at startup, and runtime-supplied base URLs are never honoured):

| Provider | `LLM_BASE_URL` |
| --- | --- |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| xAI / Grok | `https://api.x.ai/v1` |

Requests use `httpx` with a finite timeout, an output-token cap and deterministic
temperature (`0`). Errors (auth / quota / rate-limit / unsupported / malformed /
connection / timeout) map to honest messages with **no silent provider or model
switch**. Optional limits (`LLM_TIMEOUT_SECONDS`, `LLM_MAX_OUTPUT_TOKENS`,
`CHAT_MAX_MESSAGE_CHARS`, `CHAT_DAILY_REQUEST_LIMIT`, `CHAT_RETENTION_DAYS`) have
safe defaults.

> Free tiers are not guaranteed and no quota is hard-coded — check your chosen
> provider's current terms and pricing.

### Privacy, consent and data handling

- **Explicit consent first.** Before the first model request the user must accept a
  disclosure naming the provider/model, what data is transmitted, and that the
  provider's own retention/training terms apply. Consent is stored and re-checked
  **server-side**; changing provider requires re-consent, and consent can be withdrawn
  from the assistant header at any time.
- **Minimal context.** Only the record facts relevant to the routed question are sent
  — never credentials, session tokens, account identifiers or unnecessary free-text
  health notes.
- **Retention / export / deletion.** Per-user retention defaults to 90 days
  (30 / 90 / 365 / keep-until-deleted). Retention is enforced by a real cleanup task:
  `backend\venv\Scripts\python -m chatagent.chatbot.services.retention` (also triggerable
  via `POST /api/chat/maintenance/retention`). Single-thread and full JSON export and
  delete-all-history are supported. **Deleting chats here never claims to delete
  records already transmitted to the provider.**

### API surface (all authenticated, all user-scoped)

`GET /api/chat/status` · `GET|PUT /api/chat/settings` ·
`GET|POST /api/chat/threads` · `GET|PATCH|DELETE /api/chat/threads/{id}` ·
`GET|POST /api/chat/threads/{id}/messages` · `POST /api/chat/threads/{id}/retry` ·
`GET /api/chat/export` · `GET /api/chat/threads/{id}/export` ·
`DELETE /api/chat/history`.

### Limitations (not faked)

- No embeddings / vector database / “semantic memory” — retrieval is trusted,
user-scoped domain functions only.
- No multi-turn tool-calling against the database; the model cannot fetch data.
- Informational only: every finance/health answer carries a brief
  *not financial / medical advice* disclaimer. It is not a substitute for a
  professional.
- Live provider calls are **not** part of the automated suite (mocked for
determinism). Configure real credentials and exercise it end-to-end before relying
on it.

## Project layout

```
.
├── index.html
├── vite.config.ts          # Vite + Vitest config (@ alias, jsdom, setup file, /api proxy)
├── docker-compose.yml      # Postgres + API + Mailpit + Vite
├── tailwind.config.js      # design tokens mapped to utilities
├── postcss.config.js
├── tsconfig.json / tsconfig.node.json
├── .env.example            # frontend proxy target (VITE_API_PROXY)
├── backend/
│   ├── Dockerfile · entrypoint.sh · requirements.txt · .env.example · alembic.ini
│   ├── alembic/            # env.py + versions/ 0001_initial · 0002_chatbot · 0003_google_auth
│   ├── app/
│   │   ├── main.py         # CORS, prod-config validation, rate limit, routers
│   │   ├── core/           # config, db, security (Argon2id/CSRF), firebase (Admin SDK verify),
│   │   │                   #   mail (SMTP/Resend), email_templates (HTML+text), rate_limit, defaults
│   │   ├── models.py       # User (firebase_uid, nullable password_hash) / AccountSettings / Session / AuthToken / Record
│   │   ├── schemas.py      # pydantic I/O (UserOut, LoginIn, …)
│   │   ├── services.py     # record validation + transactional upsert/replace/delete
│   │   ├── deps.py         # session/cookie + CSRF resolution, require_reauth
│   │   └── api/            # auth.py + resources.py (CRUD/bootstrap/import/reset)
│   └── tests/              # 54 pytest: auth, firebase auth, tokens, ownership/cross-user,
│                           #   config, email providers
├── chatagent/              # Read-only assistant (repo-root package, imported by the app)
│   └── chatbot/
│       ├── config.py       # ChatSettings (LLM_MODEL/BASE_URL/API_KEY + limits)
│       ├── models.py       # ChatThread / ChatMessage / ChatSettingsRecord (shared Base)
│       ├── providers/      # base resolver + openai_compatible (httpx); key never exposed
│       ├── context/        # money + finance + health fact builders (deterministic)
│       ├── safety/         # intent router, prohibited-policy, output validation
│       ├── services/       # chat pipeline, threads CRUD/export/settings, retention CLI
│       ├── api/routes.py   # /api/chat/* endpoints (auth, consent gate, limits)
│       └── tests/          # 65 pytest: providers, context, policy, validation, api,
│                           #   ownership, retention (mock provider; no live LLM)
└── src
    ├── main.tsx / App.tsx  # providers, auth Gate (checking/authed/anon/unreachable), boot, routes
    ├── index.css           # CSS-variable design tokens + base styles
    ├── pages/              # Onboarding, Overview, Money, Health, Roast, Insights, Assistant, Settings
    │   └── Login · CheckEmail · ForgotPassword · ResetPassword · auth/AuthLayout
    ├── components/         # ui/, layout/, charts/, forms/, Icon, ToastHost
    ├── api/                # http.ts (ApiError network-vs-401, cookies, CSRF) · auth.ts · chat.ts
    ├── state/              # store.tsx (AppProvider), auth.tsx (AuthProvider), month.tsx, useMoney.ts
    ├── domain/             # types, money, finance, roast, date, categories, schemas (+ tests)
    ├── repo/               # db.ts, local.ts, remote.ts (Repository impls) (+ tests)
    ├── lib/                # csv.ts, cn.ts, config.ts (API_BASE/CSRF), importLocal.ts,
    │                     #   firebase.ts (SDK init) · firebaseAuth.ts (sign-up/in + Google + verify)
    └── test/setup.ts       # fake-indexeddb + jest-dom + cleanup
```

---

*Built as a functional implementation of the Personal Life Tracker brief, using the
supplied improved-UI package as the design source of truth. Runs fully local in the
browser, or against a self-hosted FastAPI + PostgreSQL backend with real accounts.*
