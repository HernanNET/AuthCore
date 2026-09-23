import type { APIRoute } from "astro";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { pool } from "@/lib/database";
import { env } from "@/lib/env";

/**
 * Phase 24 — machine-facing user provisioning.
 *
 * The multiclient product needs an administrator to create seller accounts
 * without an email round-trip (production has no verified Resend sender yet, and
 * Better Auth's admin plugin deliberately forbids user creation). This endpoint
 * is intentionally narrow and fail-closed:
 *
 *   - requires the `x-authcore-provision-secret` header to match
 *     AUTHCORE_PROVISION_SECRET (constant-time compare); unset secret disables it
 *   - creates exactly one verified credential user with a role from a whitelist
 *   - never sends email, never logs secrets, never returns tokens
 *
 * Roles: admin | seller | user. Consumers keep their own authorization; this
 * endpoint only provisions the credential.
 */

const ALLOWED_ROLES = new Set(["admin", "seller", "user"]);
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 200;

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function safeEqual(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 120;
}

export const POST: APIRoute = async ({ request }) => {
  const configuredSecret = env.AUTHCORE_PROVISION_SECRET;
  if (!configuredSecret) return json({ error: "provisioning_disabled" }, 503);

  const providedSecret = request.headers.get("x-authcore-provision-secret") ?? "";
  if (!providedSecret || !safeEqual(providedSecret, configuredSecret)) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: { email?: unknown; name?: unknown; password?: unknown; role?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role = typeof body.role === "string" ? body.role : "seller";

  if (!isValidEmail(email)) return json({ error: "invalid_email" }, 400);
  if (name.length < 2) return json({ error: "invalid_name" }, 400);
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return json({ error: "weak_password" }, 400);
  }
  if (!ALLOWED_ROLES.has(role)) return json({ error: "invalid_role" }, 400);

  const existing = await pool.query('SELECT id FROM "user" WHERE email = $1 LIMIT 1', [email]);
  if (existing.rows[0]) return json({ error: "email_exists" }, 409);

  const userId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      'INSERT INTO "user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt", "twoFactorEnabled", role, banned) ' +
        "VALUES ($1, $2, $3, true, NULL, now(), now(), false, $4, false)",
      [userId, name, email, role],
    );
    await client.query(
      'INSERT INTO account (id, issuer, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") ' +
        "VALUES ($1, $2, $3, $4, $5, $6, now(), now())",
      [randomUUID(), "local:credential", userId, "credential", userId, await hashPassword(password)],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[provision] failed:", error instanceof Error ? error.message : String(error));
    return json({ error: "provision_failed" }, 500);
  } finally {
    client.release();
  }

  // Only the id is returned; the consumer mirrors its own role/scope locally.
  return json({ user: { id: userId, email, name, role } }, 201);
};

export const GET: APIRoute = async () => json({ error: "method_not_allowed" }, 405);
