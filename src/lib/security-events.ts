import { pool } from "./database";
import { securityAlertEmailTransport } from "./email";

export const SECURITY_EVENT_TYPES = [
  "account_created",
  "signed_in",
  "signed_out",
  "password_changed",
  "email_change_requested",
  "two_factor_enabled",
  "two_factor_disabled",
  "passkey_added",
  "passkey_deleted",
  "session_revoked",
  "other_sessions_revoked",
  "account_deletion_requested",
  "admin_user_blocked",
  "admin_user_unblocked",
  "admin_sessions_revoked",
] as const;

export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

export type SecurityEvent = {
  id: string;
  type: SecurityEventType;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
};

const ALWAYS_ALERT = new Set<SecurityEventType>([
  "password_changed",
  "email_change_requested",
  "two_factor_enabled",
  "two_factor_disabled",
  "passkey_added",
  "passkey_deleted",
  "account_deletion_requested",
  "admin_user_blocked",
  "admin_user_unblocked",
  "admin_sessions_revoked",
]);

async function shouldSendAlert(input: {
  userId: string;
  type: SecurityEventType;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<boolean> {
  if (ALWAYS_ALERT.has(input.type)) return true;
  if (input.type !== "signed_in") return false;

  const { rowCount } = await pool.query(
    `SELECT 1 FROM "securityEvent"
     WHERE "userId" = $1 AND type = 'signed_in'
       AND "ipAddress" IS NOT DISTINCT FROM $2
       AND "userAgent" IS NOT DISTINCT FROM $3
     LIMIT 1`,
    [input.userId, input.ipAddress || null, input.userAgent?.slice(0, 512) || null],
  );
  return rowCount === 0;
}

async function sendSecurityAlert(input: {
  userId: string;
  type: SecurityEventType;
  occurredAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<void> {
  try {
    const { rows } = await pool.query('SELECT email FROM "user" WHERE id = $1', [input.userId]);
    const email = rows[0]?.email as string | undefined;
    if (!email) return;
    await securityAlertEmailTransport.sendSecurityAlert({
      to: email,
      eventType: input.type,
      occurredAt: input.occurredAt,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
  } catch (error) {
    // Alerts are informational: a provider outage must not roll back auth.
    console.error("[authcore] unable to send security alert", error);
  }
}

export async function ensureSecurityEventSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "securityEvent" (
      id TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      "ipAddress" TEXT,
      "userAgent" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "securityEvent_userId_createdAt_idx"
    ON "securityEvent" ("userId", "createdAt" DESC)
  `);
}

export async function recordSecurityEvent(input: {
  userId: string;
  type: SecurityEventType;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<boolean> {
  try {
    const alert = await shouldSendAlert(input);
    const occurredAt = new Date().toISOString();
    const ipAddress = input.ipAddress?.slice(0, 128) || null;
    const userAgent = input.userAgent?.slice(0, 512) || null;
    await pool.query(
      `INSERT INTO "securityEvent" (id, "userId", type, "ipAddress", "userAgent", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        crypto.randomUUID(),
        input.userId,
        input.type,
        ipAddress,
        userAgent,
        occurredAt,
      ],
    );
    if (alert) {
      await sendSecurityAlert({
        userId: input.userId,
        type: input.type,
        occurredAt,
        ipAddress,
        userAgent,
      });
    }
    return true;
  } catch (error) {
    // Authentication must fail safely if the optional audit sink is unavailable.
    console.error("[authcore] unable to record security event", error);
    return false;
  }
}

export async function listSecurityEvents(userId: string, limit = 50): Promise<SecurityEvent[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const { rows } = await pool.query(
    `SELECT id, type, "ipAddress", "userAgent", "createdAt"
     FROM "securityEvent"
     WHERE "userId" = $1
     ORDER BY "createdAt" DESC
     LIMIT $2`,
    [userId, safeLimit],
  );
  return rows as SecurityEvent[];
}

export function requestMetadata(headers: Headers, fallbackIp?: string | null) {
  const forwarded = headers.get("x-forwarded-for");
  const singleForwarded = forwarded && !forwarded.includes(",") ? forwarded.trim() : null;
  return {
    ipAddress:
      headers.get("cf-connecting-ip")?.trim() ||
      headers.get("x-real-ip")?.trim() ||
      singleForwarded ||
      fallbackIp ||
      null,
    userAgent: headers.get("user-agent")?.trim() || null,
  };
}
