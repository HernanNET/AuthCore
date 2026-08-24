import type { APIRoute } from "astro";
import { auth } from "@/lib/auth";
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
};

/**
 * Better Auth catch-all handler. Mounts the full auth API under /api/auth/*.
 * Better Auth validates methods and bodies, and rejects malformed requests.
 */
export const ALL: APIRoute = async (ctx) => {
  const authPath = new URL(ctx.request.url).pathname.replace(/^\/api\/auth/, "");
  const targetEventType = ADMIN_TARGET_EVENTS[authPath];
  const requestCopy = targetEventType ? ctx.request.clone() : null;
  const sessionBefore = await auth.api.getSession({ headers: ctx.request.headers });
  const response = await auth.handler(ctx.request);
  const eventType = SUCCESS_EVENTS[authPath];

  if (response.ok && sessionBefore && eventType) {
    // A TOTP verification during login has no pre-existing session. Therefore
    // this path means enrollment only when sessionBefore exists.
    await recordSecurityEvent({
      userId: sessionBefore.user.id,
      type: eventType,
      ...requestMetadata(ctx.request.headers, sessionBefore.session.ipAddress),
    });
  }

  if (response.ok && sessionBefore && targetEventType && requestCopy) {
    const body = await requestCopy.json().catch(() => null) as { userId?: unknown } | null;
    if (typeof body?.userId === "string" && body.userId.length > 0) {
      await recordSecurityEvent({
        userId: body.userId,
        type: targetEventType,
        ...requestMetadata(ctx.request.headers, sessionBefore.session.ipAddress),
      });
    }
  }

  return response;
};
