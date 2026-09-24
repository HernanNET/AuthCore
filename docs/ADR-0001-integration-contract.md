# ADR-0001 — Integration contract and versioning policy

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** Product owner (Italy AI Studio)
- **Scope:** AuthCore as a reusable authentication module consumed by multiple web applications

## Context

AuthCore is not a standalone product: it is an identity module consumed by several
first-party web applications (e.g. the multiclient seller panel, the calendar admin
API, and other future consumers). Those applications depend on the shape and behavior
of:

- the machine-facing endpoints `GET /api/authcore/verify` and
  `POST /api/authcore/provision`,
- the role vocabulary (`user` | `seller` | `admin`),
- the JSON shape of a verified session/user response.

Uncoordinated changes to that surface can silently break consumers. This ADR locks a
**frozen contract version (v1)** and defines how it evolves.

## Decision

1. **Contract version.** The integration surface is versioned. Current version is
   `1`, reported in `GET /api/authcore/verify` as `contractVersion` (body) and as the
   `X-AuthCore-Contract-Version` response header (both authenticated and
   unauthenticated responses).

2. **Frozen v1 surface.** The following are considered part of contract v1 and must
   not change in a breaking way:
   - `GET /api/authcore/verify` response shape (`authenticated`, `contractVersion`,
     `admin`, `roles`, `user.id`, `user.name`, `user.email`) and status semantics.
   - `POST /api/authcore/provision` request/response contract.
   - Role identifiers `user`, `seller`, `admin`.
   - The Admin UI capability model (Phase 18 + Phase 25 user CRUD): an admin can
     create, list, get, update, set role, set password, ban/unban, revoke sessions,
     and delete non-protected users. **Impersonation is intentionally excluded** and
     must be re-evaluated separately before being offered.

3. **Semantic versioning for the module.** The AuthCore repository follows SemVer:
   - **major** — breaking change to the integration contract (new contract version).
   - **minor** — additive capability (new endpoint, new role, new Admin UI feature)
     that keeps v1 consumers working.
   - **patch** — fixes that do not alter the contract.

4. **Compatibility policy.**
   - Contract changes are **additive** while possible; deprecations are announced
     with a window (this CHANGELOG) before removal.
   - Consumers declare which contract version they target in their own docs.
   - A compatibility matrix lives in this ADR (see below) and is updated on release.

5. **Protections.** Protected accounts (the acting admin itself and any admin-role
   user) cannot be banned, deleted, demoted, or have their password set, enforced
   server-side in `/api/auth/*` — not only in the UI. This also guarantees that the
   last administrator can never be removed through the Admin UI. Administrators
   must enable **two-factor authentication** before any administrative access
   (Phase 26 policy), enforced on the Admin UI and on every `/admin/*` endpoint.

## Compatibility matrix

| Consumer | AuthCore contract | Notes |
|---|---|---|
| Multicliente panel (`clienti.italyaistudio.com`) | v1 | `verify` + `provision` |
| Calendar admin API | v1 | `verify` |
| Socialdrinking (`auth.socialdrinking.it`) | v1 | Resend domain / email |

## Consequences

- Breaking changes require a contract version bump and explicit consumer migration.
- Adding a role or an admin capability is a **minor** release; renaming or removing a
  role/endpoint is a **major** release.
- New Admin UI capabilities must keep the least-privilege posture (only grant what
  the UI uses) and keep impersonation excluded until separately approved.