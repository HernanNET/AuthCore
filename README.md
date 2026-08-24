# AuthCore

Standalone, reusable authentication module built on **Better Auth** + **PostgreSQL**,
served by **Astro** (Node.js). The module owns its own PostgreSQL database and exposes
a small facade (`signUp`, and later `signIn` / `signOut` / `getSession` / `getCurrentUser`)
so consuming applications never touch Better Auth internals.

```
App  ->  Auth Module (facade)  ->  Better Auth  ->  PostgreSQL
```

## Current scope (Phases 1–19)

- **Phase 1**: Registration (name, email, password, confirm)
- **Phase 2**: Email verification (native Better Auth, captured mailbox for dev/test)
- **Phase 3**: Email/password login (verified users only, `requireEmailVerification`)
- **Phase 4**: Logout + current-session invalidation
- **Phase 5**: Google OAuth login
- **Phase 6**: Forgot/reset password (one-time tokens + session revocation)
- **Phase 7**: Authenticated password change (current-password proof + other-session revocation)
- **Phase 8**: Session and device management (list + selective/bulk revocation)
- **Phase 9**: Secure email change (current-address approval + new-address verification)
- **Phase 10**: Verified account deletion (explicit intent + complete identity cleanup)
- **Phase 11**: TOTP two-factor authentication + one-time recovery codes
- **Phase 12**: Passkeys/WebAuthn (registration, passwordless sign-in, rename, revocation)
- **Phase 13**: Database-backed rate limiting and brute-force protection
- **Phase 14**: Server-side security activity and audit history
- **Phase 15**: Token-free email alerts for new sign-ins and critical changes
- **Phase 16**: Real transactional email delivery (code/configuration pending DNS verification)
- **Phase 17**: Server-enforced user/admin roles and protected administration boundary
- **Phase 18**: Least-privilege user search, blocking, unblocking, and session revocation
- **Phase 19**: HTTP security headers, hashed CSP, cache protection, and HTTPS-only HSTS

## Roles and administration

Better Auth's official Admin plugin owns the `user` and `admin` roles. Every new
registration receives `user` on the server; role input supplied by a browser is
ignored. `/admin` revalidates both the session and admin permission server-side
and exposes only safe user fields and explicitly allowed management actions.

- Anonymous requests are redirected to `/login`.
- Authenticated non-admin users receive HTTP 403.
- The Administration link is rendered only for an admin, but hiding the link is
  never treated as the authorization boundary.
- Role changes take effect on the next request; AuthCore does not cache roles in
  cookies.
- Bootstrap the first verified local administrator with:

  ```powershell
  pnpm admin:promote -- user@example.com
  ```

- Return an administrator to the regular role with:

  ```powershell
  pnpm admin:demote -- user@example.com
  ```

These commands operate on the configured local database and refuse unverified
or nonexistent users.

## Administrative user management

`/admin` supports bounded email/name search, pagination, account blocking and
unblocking, and revocation of every session owned by a selected user.

- Better Auth's native Admin endpoints revalidate the administrator session.
- The custom access-control role grants only `user:list`, `user:get`,
  `user:ban`, and `session:revoke`.
- User creation, deletion, role changes, password/email changes, and
  impersonation remain forbidden even through direct API calls.
- The current administrator and other administrators have no destructive UI
  controls; Better Auth also rejects self-blocking server-side.
- Blocking immediately deletes the selected user's active sessions.
- Blocking, unblocking, and administrative session revocation are written to
  the affected user's security activity and produce token-free alerts.
- Raw session tokens, password data, and authentication secrets are never
  rendered in the administration page.

## Transactional email status

Phase 16 remains pending until `auth.socialdrinking.it` is verified in Resend by
adding its SPF/DKIM records in Cloudflare. Development and automated tests keep
using the captured mailbox; no API key is stored or required yet.

## Security email alerts

Security events can trigger an informational email after the operation succeeds.
New sign-in alerts are sent only for a previously unseen IP + browser combination;
familiar contexts do not generate repeated mail.

- Alerts cover new sign-in contexts, password/email changes, 2FA changes,
  passkey changes, and account-deletion requests.
- Failed authentication attempts never generate mail and cannot be used for spam.
- Messages contain event type, time, bounded device data, and IP only.
- Alerts contain no action URL, password, cookie, token, TOTP secret, or recovery code.
- Development/test uses the captured mailbox. Production requires a real provider;
  delivery failures are logged but never roll back a successful authentication action.

## Security activity

`/security-activity` is server-protected and shows the authenticated user their
50 most recent security events. Account creation and session creation are captured
through Better Auth database hooks; successful sensitive API operations are recorded
after the native handler accepts them.

- Events contain only type, timestamp, IP address, and a bounded user-agent value.
- Passwords, cookies, tokens, TOTP secrets, and recovery codes are never recorded.
- A user can query only events tied to their own server-validated session.
- Security history is deleted automatically with the owning user (`ON DELETE CASCADE`).
- Audit write failures are logged server-side but never break authentication.

## Rate limiting and abuse protection

Better Auth's native rate limiter is enabled in every environment and persists
counters in PostgreSQL so limits survive process restarts and work across multiple
application instances.

- Email/password login: 5 attempts per IP per 60 seconds.
- Registration: 5 attempts per IP per hour.
- Password-reset requests: 3 attempts per IP per 5 minutes.
- Two-factor endpoints: 5 attempts per IP per 60 seconds.
- Passkey endpoints: 20 attempts per IP per 60 seconds.
- Blocked requests return HTTP 429 plus `X-Retry-After`; the UI shows a safe message.
- Production proxies must overwrite or sanitize forwarded IP headers and prevent
  direct access to the application origin.

## Passkeys

`/passkeys` lets an authenticated user register and manage WebAuthn credentials
stored by Windows Hello, a phone, a password manager, or a hardware security key.

- `/login` supports passwordless passkey sign-in without asking for an email.
- WebAuthn requires user verification (biometric or device PIN).
- Passkeys are scoped to the configured origin and relying-party domain.
- Users can label, rename, list, and revoke individual passkeys.
- Public keys and metadata are stored in PostgreSQL; private keys never leave the authenticator.
- `localhost` is supported for development; production must use a valid HTTPS origin.

## Two-factor authentication

`/two-factor-setup` enrolls credential users after rechecking their current
password. Better Auth generates and encrypts the TOTP secret and recovery codes.

- 2FA remains disabled until a valid authenticator code completes enrollment.
- Password login creates no authenticated session while the 2FA challenge is pending.
- `/two-factor` accepts current TOTP codes or a one-time recovery code.
- Recovery codes are shown only during enrollment and are invalid after use.
- Users can disable 2FA only after proving their current password again.

## Verified account deletion

`/delete-account` is server-protected and requires the user to type `DELETE`
and acknowledge that the operation is irreversible. Better Auth then sends a
short-lived verification link to the account's verified email.

- Requesting deletion does not remove or modify any account data.
- The final link requires both a valid one-time token and the matching session.
- The token is consumed server-side and is never rendered into the DOM.
- Successful confirmation permanently deletes the user, linked credential/OAuth
  accounts, every session, and the consumed verification record.
- Production fails closed until a real account-deletion email transport exists.

## Secure email change

`/change-email` is server-protected and delegates the entire identity update to
Better Auth's native change-email flow.

- The request is first approved from the current verified email address.
- A second verification link is then sent to the new address.
- The database email is unchanged until both steps are complete.
- Existing target addresses receive the same generic response to prevent enumeration.
- The user id, linked credential/Google accounts, and active session are preserved.
- Development/test messages use the captured mailbox; production fails closed until
  a real transactional email transport is configured.

## Session and device management

`/sessions` is server-protected and uses Better Auth's native session-management
endpoints. It identifies the current browser and shows only safe device metadata.

- A user can revoke one other session or every other session.
- The current session is preserved and cannot be revoked from its own card.
- Raw session tokens remain inside the client facade and are never rendered in the DOM.
- Revocation takes effect immediately because AuthCore does not enable cookie caching.

## Authenticated password change

`/change-password` is server-protected and requires an active session. The flow:

- requires the current password before accepting a new one;
- delegates password verification and hashing to Better Auth;
- revokes every other session after a successful change;
- issues a replacement cookie so the current browser remains signed in;
- returns safe errors for incorrect passwords and accounts without credentials.

## Password reset

Phase 6 uses Better Auth's native password-reset endpoints. AuthCore does not
implement its own token format or password update SQL.

- `/forgot-password` always shows the same success message for known and unknown emails.
- Reset links are single-use and expire after `PASSWORD_RESET_EXPIRES_IN_SECONDS`.
- A successful reset revokes every existing session for that user.
- Development/test reset messages use the captured mailbox; production fails closed
  until a real email transport is configured.
- `/reset-password` maps invalid, expired, and replayed tokens to safe UI messages.

## Google OAuth setup

Google OAuth uses Better Auth's native Google provider. No manual code exchange.

### 1. Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create OAuth client ID → Web application
3. Add authorized redirect URI:

**Development:**
```
http://localhost:4321/api/auth/callback/google
```

**Production pattern:**
```
https://your-domain.com/api/auth/callback/google
```

### 2. Configure `.env`

Add to `.env` (never commit real credentials):

```
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
```

Leave both empty to disable Google OAuth.

### 3. Account linking

Better Auth uses its safe default account-linking behavior:
- No `trustedProviders` hacks
- No `allowDifferentEmails`
- A verified Google email matching an existing verified local user will be linked to the same user (one user, two accounts: credential + google)
- Better Auth owns the linking logic — no manual SQL

## Prerequisites

- Node.js 20+
- pnpm 9+
- Docker (used to run PostgreSQL)

## Stack

| Concern        | Choice                                  |
| -------------- | --------------------------------------- |
| Framework      | Astro (Node adapter, `output: server`)  |
| Auth library   | Better Auth                             |
| Database       | PostgreSQL 16 (Docker Compose)          |
| Package manager| pnpm                                    |
| E2E tests      | Playwright                              |

## Database

The auth module owns two databases inside a single Postgres container:

| Database        | Purpose | Loaded from |
| --------------- | ------- | ----------- |
| `authcore_dev`  | dev     | `.env`      |
| `authcore_test` | tests   | `.env.test` |

Credentials are identical across both (Docker-local, `authcore` user); only the
database name differs. **Tests never touch the development or production databases.**

### Connection configuration (server-only)

| Variable             | Example                                                         |
| -------------------- | --------------------------------------------------------------- |
| `DATABASE_URL`       | `postgres://authcore:authcore_dev@localhost:5432/authcore_dev`  |
| `BETTER_AUTH_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `BETTER_AUTH_URL`    | `http://localhost:4321`                                         |
| `AUTH_ENV`           | `test` selects `.env.test`; anything else selects `.env`        |
| `GOOGLE_CLIENT_ID`   | Google OAuth client ID (empty = disabled)                       |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret (empty = disabled, server-only)    |
| `PASSWORD_RESET_EXPIRES_IN_SECONDS` | Reset-token lifetime; defaults to 3600 seconds |
| `ACCOUNT_DELETION_EXPIRES_IN_SECONDS` | Account-deletion link lifetime; defaults to 3600 seconds |

These are **server-only**. They are read via `process.env` in `src/lib/env.ts` and are
never exposed to the client bundle (no `PUBLIC_` prefix, never imported client-side).

### Schema

Better Auth owns and creates the core tables via migration:

- `user`
- `account`
- `session`
- `verification`
- `passkey`
- `rateLimit`
- `securityEvent`

(plus any internal tables Better Auth requires). No second user database is used.

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Create env files (never commit real secrets)
cp .env.example .env
# generate a secret and paste into .env:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# repeat for .env.test (separate secret + authcore_test database)

# 3. Start PostgreSQL (creates authcore_dev + authcore_test)
pnpm db:up

# 4. Apply migrations
pnpm db:migrate        # development database
pnpm db:migrate:test   # test database
```

## Commands

| Command                | Description                                          |
| ---------------------- | ---------------------------------------------------- |
| `pnpm install`         | install dependencies                                 |
| `pnpm db:up`           | start PostgreSQL container (dev + test databases)    |
| `pnpm db:down`         | stop PostgreSQL container                            |
| `pnpm db:migrate`      | apply Better Auth migrations to the dev database     |
| `pnpm db:migrate:test` | apply Better Auth migrations to the test database    |
| `pnpm admin:promote -- <email>` | promote one verified local user to admin |
| `pnpm admin:demote -- <email>` | return one verified local admin to user    |
| `pnpm dev`             | start Astro dev server (http://localhost:4321)        |
| `pnpm build`           | build the Astro server (type-checks + bundles)       |
| `pnpm check`           | `astro check` (TypeScript / template diagnostics)    |
| `pnpm start`           | run the built standalone server                      |
| `pnpm test:e2e`        | run Playwright acceptance tests against the test DB  |
| `pnpm test:e2e:ui`     | run Playwright with the interactive UI               |

## Test database setup

Playwright runs against the **test** database only:

- `pnpm test:e2e` sets `AUTH_ENV=test`, which makes the server load `.env.test`.
- Playwright `globalSetup` applies migrations to `authcore_test` and cleans
  `playwright-*@example.test` users before each run.
- Each test uses an isolated browser context and a unique email of the form
  `playwright-<timestamp>-<rand>@example.test`.
- `globalTeardown` removes test users after the run.

## Security

- Passwords are hashed by Better Auth (scrypt); never stored in plaintext.
- `BETTER_AUTH_SECRET` and `DATABASE_URL` are server-only and gitignored.
- `.env` / `.env.test` are gitignored; only `.env.example` is committed.
- The client bundle contains no server secrets.
- Better Auth rejects malformed sign-up requests server-side; the UI shows only
  safe, mapped error messages.
- Forgot-password responses do not reveal whether an email is registered.
- Password-reset tokens are generated, stored, consumed, and expired by Better Auth.
- Successful password resets revoke all existing sessions.
- Authenticated password changes require proof of the current password and revoke
  all sessions except the current browser's replacement session.
- Session management exposes device metadata but never renders raw session tokens;
  selective and bulk revocation preserve the current browser.
- Email changes require control of both the current and new addresses, use native
  signed links, and do not reveal whether the requested target already exists.
- Account deletion requires explicit local intent plus a one-time emailed link
  bound to the same signed-in user, then removes the full local identity graph.
- TOTP secrets and recovery codes are generated and encrypted by Better Auth;
  neither is rendered before password reauthentication.
- Passkey private keys remain on the authenticator; AuthCore stores only public
  credential material and requires device-level user verification.
- High-risk public endpoints use persistent per-IP throttles. Responses never
  disclose whether the submitted email belongs to an account.
- Every application and auth response carries anti-framing, MIME-sniffing,
  referrer, permissions, opener, and no-store protections. Astro generates a
  SHA-256 Content Security Policy for production scripts and styles; HSTS is
  emitted only when `BETTER_AUTH_URL` uses HTTPS.

## Project structure

```
src/
  lib/
    env.ts             # server-only env loading + validation
    auth.ts            # Better Auth server instance (owns PG connection)
    auth-facade.ts     # client facade (signUp/signIn/reset...) — no server secrets
  pages/
    api/auth/[...all].ts  # Better Auth catch-all handler (/api/auth/*)
    register.astro        # registration page
    forgot-password.astro # generic reset request UI
    reset-password.astro  # one-time-token password update UI
    change-password.astro # authenticated password change UI
    sessions.astro        # active-session list and revocation UI
    change-email.astro    # authenticated double-confirmation request UI
    change-email-result.astro # safe confirmation/verification result UI
    delete-account.astro  # explicit irreversible-action request UI
    confirm-account-deletion.astro # server-only token consumption
    account-deleted.astro # safe final deletion result
    two-factor-setup.astro # TOTP enrollment and disable flow
    two-factor.astro       # login challenge and recovery-code flow
    passkeys.astro         # WebAuthn registration and passkey management
    security-activity.astro # authenticated, user-scoped security history
    admin.astro          # least-privilege administrative user management
    index.astro           # redirects to /register
  env.d.ts
scripts/
  migrate.ts          # programmatic Better Auth migrations
tests/
  helpers/db.ts       # test-only PG access for DB assertions
  global-setup.ts     # migrate test DB + clean test users
  global-teardown.ts  # clean test users after run
  e2e/register.spec.ts # 7 Playwright acceptance tests
docker/
  init-db.sh          # creates authcore_test next to authcore_dev
docker-compose.yml
playwright.config.ts
```
