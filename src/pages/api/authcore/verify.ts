import type { APIRoute } from "astro";
import {
  getCurrentSession,
  getUserRoles,
  isAdminUser,
} from "@/lib/session";

/**
 * Frozen integration contract version for first-party consumers. Bump only for
 * additive (minor) or breaking (major) contract changes; see docs/ADR-0001.
 */
const CONTRACT_VERSION = "1";

/**
 * Machine-facing session verification endpoint for first-party consuming
 * applications (e.g. an admin panel served from another trusted origin).
 *
 * The consumer forwards the browser's session cookie here. The endpoint uses
 * only Better Auth's native session API through the narrow session boundary
 * and never returns session tokens or internals. Role information lets the
 * consuming application enforce its own authorization (for example, an admin
 * dashboard) without duplicating role logic.
 */
export const GET: APIRoute = async ({ request }) => {
  const session = await getCurrentSession(request.headers);
  if (!session) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 401,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "X-AuthCore-Contract-Version": CONTRACT_VERSION,
      },
    });
  }
  const roles: string[] = getUserRoles(session.user);
  return new Response(
    JSON.stringify({
      authenticated: true,
      contractVersion: CONTRACT_VERSION,
      admin: isAdminUser(session.user),
      roles,
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "X-AuthCore-Contract-Version": CONTRACT_VERSION,
      },
    },
  );
};

