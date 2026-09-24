import { auth } from "./auth";

/**
 * Server-side session helpers — the narrow boundary for consuming applications.
 *
 * These functions use Better Auth's native session API. They never parse raw
 * cookies, query the session table manually, or expose session tokens.
 */

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
export type AuthRole = "user" | "admin";

/** Parse Better Auth's comma-separated role representation defensively. */
export function getUserRoles(user: User): string[] {
  const role = "role" in user && typeof user.role === "string" ? user.role : "user";
  return role
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function userHasRole(user: User, role: AuthRole): boolean {
  return getUserRoles(user).includes(role);
}

export function isAdminUser(user: User): boolean {
  return userHasRole(user, "admin");
}

/**
 * Get the current session from request headers (cookies).
 * Returns null if not authenticated.
 */
export async function getCurrentSession(
  headers: Headers,
): Promise<Session | null> {
  const session = await auth.api.getSession({ headers });
  return session ?? null;
}

/**
 * Get the current user from request headers (cookies).
 * Returns null if not authenticated.
 */
export async function getCurrentUser(
  headers: Headers,
): Promise<User | null> {
  const session = await getCurrentSession(headers);
  return session?.user ?? null;
}

/**
 * Require an authenticated user. Returns the session or throws a redirect
 * to /login if not authenticated.
 *
 * Usage in Astro pages:
 *   ---
 *   import { requireAuthenticatedUser } from "@/lib/session";
 *   const session = await requireAuthenticatedUser(Astro);
 *   ---
 */
export async function requireAuthenticatedUser(
  astro: { request: Request; redirect: (path: string) => Response },
): Promise<Session> {
  const session = await getCurrentSession(astro.request.headers);
  if (!session) {
    throw astro.redirect("/login");
  }
  return session;
}

/**
 * Require a server-validated administrator session.
 * Anonymous visitors go to login; authenticated non-admins receive HTTP 403.
 * Administrators must have enabled two-factor authentication (Phase 26 policy);
 * those without it are redirected to the guidance page instead.
 */
export async function requireAdminUser(
  astro: { request: Request; redirect: (path: string) => Response },
): Promise<Session | Response> {
  const session = await getCurrentSession(astro.request.headers);
  if (!session) {
    return astro.redirect("/login");
  }
  if (!isAdminUser(session.user)) {
    return new Response("Forbidden", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (session.user.twoFactorEnabled !== true) {
    return astro.redirect("/admin/require-2fa");
  }
  return session;
}
