import type { APIRoute } from "astro";
import { auth } from "@/lib/auth";
import { resolveClientIp, withTrustedClientIp } from "@/lib/client-ip";
import { pool } from "@/lib/database";
import { env } from "@/lib/env";
import { isAdminUser } from "@/lib/session";
import {
  recordSecurityEvent,
  requestMetadata,
  type SecurityEventType,
} from "@/lib/security-events";

const SUCCESS_EVENTS: Readonly<Record<string, SecurityEventType>> = {
  "/sign-out": "signed_out",
  "/change-password": "password_changed",
  "/change-email": "email_change_requested",
  "/two-factor/verify-totp": "two_factor_enabled",
  "/two-factor/disable": "two_factor_disabled",
  "/passkey/verify-registration": "passkey_added",
  "/passkey/delete-passkey": "passkey_deleted",
  "/revoke-session": "session_revoked",
  "/revoke-sessions": "other_sessions_revoked",
  "/delete-user": "account_deletion_requested",
};

const ADMIN_TARGET_EVENTS: Readonly<Record<string, SecurityEventType>> = {
  "/admin/ban-user": "admin_user_blocked",
  "/admin/unban-user": "admin_user_unblocked",
  "/admin/revoke-user-sessions": "admin_sessions_revoked",
  "/admin/create-user": "admin_user_created",
  "/admin/update-user": "admin_user_updated",
  "/admin/set-role": "admin_role_changed",
  "/admin/set-user-password": "admin_password_set",
  "/admin/remove-user": "admin_user_deleted",
};

/**
 * Destructive admin actions that must never target a protected account
 * (the acting administrator itself or any user holding the admin role).
 * This is enforced server-side, not just in the UI.
 */
const PROTECTED_ADMIN_PATHS = new Set([
  "/admin/ban-user",
  "/admin/remove-user",
  "/admin/set-role",
  "/admin/set-user-password",
]);

async function roleOf(userId: string): Promise<string[]> {
  try {
    const { rows } = await pool.query('SELECT role FROM "user" WHERE id = $1', [userId]);
    const role = (rows[0]?.role as string | undefined) ?? "user";
    return role
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return ["user"];
  }
}

function protectedResponse(): Response {
  return new Response(JSON.stringify({ message: "This account is protected." }), {
    status: 400,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function twoFactorRequiredResponse(): Response {
  return new Response(
    JSON.stringify({ message: "Two-factor authentication is required for administration." }),
    {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8" },
    },
  );
}

/**
 * Phase 26: administration is only available to administrators who enabled
 * two-factor authentication. Enforced server-side on every /admin/* endpoint,
 * in addition to the UI redirect handled by requireAdminUser.
 */
function enforceAdminTwoFactor(
  authPath: string,
  sessionUser: typeof auth.$Infer.Session.user,
): Response | null {
  if (!authPath.startsWith("/admin/")) return null;
  if (!isAdminUser(sessionUser)) return null;
  if (sessionUser.twoFactorEnabled !== true) return twoFactorRequiredResponse();
  return null;
}

/**
 * Reject destructive admin actions against protected accounts before they reach
 * Better Auth. Only applies to authenticated administrators (a regular user
 * attempting these endpoints still gets Better Auth's own 403). Also prevents
 * role changes through the generic update endpoint.
 */
async function enforceProtectedAdminGuard(
  authPath: string,
  request: Request,
  actingUserId: string,
): Promise<Response | null> {
  if (!(await roleOf(actingUserId)).includes("admin")) return null;
  const body = (await request.clone().json().catch(() => null)) as {
    userId?: unknown;
    data?: { role?: unknown } | null;
  } | null;
  const targetId = typeof body?.userId === "string" && body.userId.length > 0 ? body.userId : null;
  if (!targetId) return null;
  if (targetId === actingUserId) return protectedResponse();

  if (PROTECTED_ADMIN_PATHS.has(authPath)) {
    const targetRoles = await roleOf(targetId);
    if (targetRoles.includes("admin")) return protectedResponse();
  }

  // update-user may change identity fields, but never the role of a protected
  // account (prevents demoting an admin through the generic endpoint).
  if (authPath === "/admin/update-user" && body?.data && "role" in body.data) {
    const targetRoles = await roleOf(targetId);
    if (targetRoles.includes("admin")) return protectedResponse();
  }

  return null;
}

/**
 * Better Auth catch-all handler. Mounts the full auth API under /api/auth/*.
 * Better Auth validates methods and bodies, and rejects malformed requests.
 */
export const ALL: APIRoute = async (ctx) => {
  let directAddress: string | null = null;
  try {
    directAddress = ctx.clientAddress;
  } catch {
    directAddress = null;
  }
  let clientIp = resolveClientIp({
    headers: ctx.request.headers,
    directAddress,
    proxyMode: env.AUTHCORE_PROXY_MODE,
  });
  if (env.isTestMode && ctx.request.headers.has("x-authcore-test-client-ip")) {
    clientIp = resolveClientIp({
      headers: new Headers(),
      directAddress: ctx.request.headers.get("x-authcore-test-client-ip"),
      proxyMode: "direct",
    });
  }
  const trustedRequest = withTrustedClientIp(ctx.request, clientIp);
  const authPath = new URL(trustedRequest.url).pathname.replace(/^\/api\/auth/, "");
  const targetEventType = ADMIN_TARGET_EVENTS[authPath];
  const requestCopy = targetEventType ? trustedRequest.clone() : null;
  const sessionBefore = await auth.api.getSession({ headers: trustedRequest.headers });
  if (sessionBefore) {
    const twoFactorResponse = enforceAdminTwoFactor(authPath, sessionBefore.user);
    if (twoFactorResponse) return twoFactorResponse;
    const guardResponse = await enforceProtectedAdminGuard(
      authPath,
      trustedRequest,
      sessionBefore.user.id,
    );
    if (guardResponse) return guardResponse;
  }
  const response = await auth.handler(trustedRequest);
  const eventType = SUCCESS_EVENTS[authPath];

  if (response.ok && sessionBefore && eventType) {
    // A TOTP verification during login has no pre-existing session. Therefore
    // this path means enrollment only when sessionBefore exists.
    await recordSecurityEvent({
      userId: sessionBefore.user.id,
      type: eventType,
      ...requestMetadata(trustedRequest.headers, sessionBefore.session.ipAddress),
    });
  }

  if (response.ok && sessionBefore && targetEventType) {
    if (authPath === "/admin/create-user") {
      // The request has no userId: the new user is created by the endpoint.
      const createdBody = (await response.clone().json().catch(() => null)) as {
        user?: { id?: unknown } | null;
      } | null;
      if (typeof createdBody?.user?.id === "string" && createdBody.user.id.length > 0) {
        await recordSecurityEvent({
          userId: createdBody.user.id,
          type: targetEventType,
          ...requestMetadata(trustedRequest.headers, sessionBefore.session.ipAddress),
        });
      }
    } else if (authPath === "/admin/remove-user") {
      // The target user no longer exists, so the deletion is audited on the
      // acting administrator's own activity log.
      await recordSecurityEvent({
        userId: sessionBefore.user.id,
        type: targetEventType,
        ...requestMetadata(trustedRequest.headers, sessionBefore.session.ipAddress),
      });
    } else if (requestCopy) {
      const body = await requestCopy.json().catch(() => null) as { userId?: unknown } | null;
      if (typeof body?.userId === "string" && body.userId.length > 0) {
        await recordSecurityEvent({
          userId: body.userId,
          type: targetEventType,
          ...requestMetadata(trustedRequest.headers, sessionBefore.session.ipAddress),
        });
      }
    }
  }

  return response;
};
