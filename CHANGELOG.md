# Changelog

All notable changes to AuthCore are documented here. This project adheres to
[Semantic Versioning](https://semver.org) and to the integration contract defined
in `docs/ADR-0001-integration-contract.md`.

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