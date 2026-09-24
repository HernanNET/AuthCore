# Changelog

All notable changes to AuthCore are documented here. This project adheres to
[Semantic Versioning](https://semver.org) and to the integration contract defined
in `docs/ADR-0001-integration-contract.md`.

## [0.3.0] - 2026-09-25

### Added — Phase 26: mandatory two-factor authentication for administration
- **Policy**: administrators must have two-factor authentication enabled before
  accessing any administrative surface.
  - The `/admin` area (list, create, edit, sessions) redirects an admin without
    2FA to `/admin/require-2fa` (a guidance page linking to the 2FA setup).
  - Every `/admin/*` API endpoint returns HTTP 403 until 2FA is enabled,
    enforced server-side alongside the existing protected-account guard.
- Rate-limited the destructive `/admin/*` mutations per IP (defense-in-depth).
- CI: GitHub Actions workflow (`.github/workflows/ci.yml`) runs type-check, build
  and the full main E2E suite (PostgreSQL via docker compose) on every push/PR.
- E2E: `tests/e2e/phase26.spec.ts` (blocked admin without 2FA; allowed admin with
  2FA) and a shared TOTP/admin fixture (`tests/helpers/two-factor.ts`).

### Changed
- Module version bumped `0.2.0` → `0.3.0` (minor: additive policy, contract v1
  unchanged).

## [0.2.0] - 2026-09-24

### Added — Phase 25: user administration CRUD
- **Admin UI** now offers full identity CRUD under `/admin`:
  - create a user (`/admin/users/new`) with name, email, password, role and email
    verification flag,
  - edit name/email/verified status and manage a user's active sessions
    (`/admin/users/[id]`),
  - set a user's role (`user` | `seller` | `admin`) and set a new password,
  - delete a non-protected user,
  - role and status (active/blocked) filters on the user list.
- **Access control** for the `admin` role extended to
  `user: create, list, get, update, set-role, ban, delete, set-password` and
  `session: list, revoke, delete`. Impersonation stays excluded.
- **Server-side protection**: the acting admin itself and any admin-role user cannot
  be banned, deleted, demoted, or have their password set (enforced in the auth
  catch-all handler). This also protects the last administrator.
- **Audit events** added for every admin mutation
  (`admin_user_created`, `admin_user_updated`, `admin_role_changed`,
  `admin_password_set`, `admin_user_deleted`) with security alerts on each.
- **Contract versioning** (ADR-0001): `GET /api/authcore/verify` now reports
  `contractVersion: "1"` and sets the `X-AuthCore-Contract-Version: 1` header.
- E2E suite: `tests/e2e/phase25.spec.ts` covering the CRUD flows and guards.

### Changed
- Module version bumped `0.1.0` → `0.2.0` (minor: additive, contract v1 unchanged).

## [0.1.0] - 2026

Phases 1–24: registration, verification, login (email/Google), sessions, password
flows, 2FA, passkeys, security activity, least-privilege administration
(Phase 18) and machine-facing user provisioning behind a shared secret (Phase 24).