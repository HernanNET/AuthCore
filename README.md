# AuthCore

Standalone, reusable authentication module built on **Better Auth** + **PostgreSQL**,
served by **Astro** (Node.js). The module owns its own PostgreSQL database and exposes
a small facade (`signUp`, and later `signIn` / `signOut` / `getSession` / `getCurrentUser`)
so consuming applications never touch Better Auth internals.

```
App  ->  Auth Module (facade)  ->  Better Auth  ->  PostgreSQL
```

## Phase 1 scope

Only **registration** is implemented:

- name, email, password, password confirmation
- client validation + server validation
- duplicate email rejected safely
- double-submit prevention
- success state

No login, email verification, OAuth, or sessions yet (later phases).

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

These are **server-only**. They are read via `process.env` in `src/lib/env.ts` and are
never exposed to the client bundle (no `PUBLIC_` prefix, never imported client-side).

### Schema

Better Auth owns and creates the core tables via migration:

- `user`
- `account`
- `session`
- `verification`

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

## Project structure

```
src/
  lib/
    env.ts             # server-only env loading + validation
    auth.ts            # Better Auth server instance (owns PG connection)
    auth-facade.ts     # client facade (signUp, ...) — no server secrets
  pages/
    api/auth/[...all].ts  # Better Auth catch-all handler (/api/auth/*)
    register.astro        # registration page
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
