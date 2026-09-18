import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pool } from "../src/lib/database";
import { hashPassword } from "better-auth/crypto";

/**
 * Idempotent import of legacy users into AuthCore's Better Auth tables.
 *
 * Input (JSON array):
 *   [{ uid, email, displayName, nickname, photoURL, verified }]
 *
 * Output: mapping file { "<legacyUid>": "<authcoreUserId>" } — the contract
 * SocialDrinking-Next consumes (docs/AUTHCORE_CONTRACT.md over there).
 *
 * Rules (contract with SocialDrinking-Next):
 *   - Idempotent: an email that already exists is never duplicated; the user is
 *     still included in the mapping so re-runs converge.
 *   - Passwords are NEVER migrated: a random 32-char password is generated and
 *     hashed with the same scrypt implementation Better Auth uses, so the user
 *     recovers access through forgot-password.
 *   - emailVerified mirrors the legacy `verified` flag (AuthCore blocks
 *     unverified logins, so migrated verified users can log in after a reset).
 *   - No email -> skipped_no_email. No secret or full email is ever logged.
 *
 *   npx tsx scripts/import-legacy-users.ts --input legacy-users-export.json \
 *       --output authcore-user-mapping.json [--dry-run] [--limit N]
 */

interface LegacyUserRecord {
  readonly uid: string;
  readonly email: string | null;
  readonly displayName?: string | null;
  readonly nickname?: string | null;
  readonly photoURL?: string | null;
  readonly verified?: boolean;
}

interface ImportOutcome {
  readonly status: "created" | "skipped_existing" | "skipped_no_email";
  readonly legacyUid: string;
  readonly authcoreUserId: string | null;
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const localMasked = local.slice(0, 1) + "***";
  const domainMasked = domain.replace(/^(.).*(\..+)$/, (_m, first: string, tail: string) => `${first}***${tail}`);
  return `${localMasked}@${domainMasked || "???"}`;
}

function randomPassword(): string {
  // 32 printable chars: strong enough for a forced forgot-password cycle.
  return randomBytes(24).toString("base64url");
}

function readArg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function displayNameFor(record: LegacyUserRecord): string {
  return (
    record.displayName ??
    record.nickname ??
    (record.email ? record.email.split("@")[0] : "")
  );
}

async function existingUserIdForEmail(email: string): Promise<string | null> {
  const { rows } = await pool.query('SELECT id FROM "user" WHERE email = $1 LIMIT 1', [email]);
  return rows[0] ? (rows[0].id as string) : null;
}

async function importUser(record: LegacyUserRecord): Promise<ImportOutcome> {
  if (!record.email || record.email.trim().length === 0) {
    return { status: "skipped_no_email", legacyUid: record.uid, authcoreUserId: null };
  }
  const email = record.email.trim();

  const existing = await existingUserIdForEmail(email);
  if (existing) {
    return { status: "skipped_existing", legacyUid: record.uid, authcoreUserId: existing };
  }

  const userId = randomUUID();
  const name = record.displayName || record.nickname || email.split("@")[0] || "Usuario";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      'INSERT INTO "user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt", "twoFactorEnabled", role, banned) VALUES ($1, $2, $3, $4, $5, now(), now(), false, $6, false)',
      [userId, name, email, record.verified === true, record.photoURL ?? null, "user"],
    );
    await client.query(
      'INSERT INTO account (id, issuer, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, now(), now())',
      [randomUUID(), "local:credential", userId, "credential", userId, await hashPassword(randomPassword())],
    );
    await client.query("COMMIT");
    return { status: "created", legacyUid: record.uid, authcoreUserId: userId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const inputPath = resolve(readArg("input", "legacy-users-export.json"));
  const outputPath = resolve(readArg("output", "authcore-user-mapping.json"));
  const dryRun = process.argv.includes("--dry-run");
  const limitArg = readArg("limit", "");
  const limit = limitArg ? Number.parseInt(limitArg, 10) : Number.POSITIVE_INFINITY;

  const raw = await readFile(inputPath, "utf8");
  const users = (JSON.parse(raw) as LegacyUserRecord[]).slice(0, limit);

  console.log(
    `[import] input=${inputPath} users=${users.length} mode=${dryRun ? "dry-run" : "apply"} (target db=${process.env.AUTH_ENV ?? "development"})`,
  );

  const outcomes: ImportOutcome[] = [];
  const mapping: Record<string, string> = {};

  for (const record of users) {
    const outcome: ImportOutcome = dryRun
      ? await simulate(record)
      : await importUser(record);
    outcomes.push(outcome);
    if (outcome.authcoreUserId) mapping[outcome.legacyUid] = outcome.authcoreUserId;
  }

  const created = outcomes.filter((o) => o.status === "created").length;
  const existing = outcomes.filter((o) => o.status === "skipped_existing").length;
  const noEmail = outcomes.filter((o) => o.status === "skipped_no_email").length;
  console.log(`[import] created=${created} skipped_existing=${existing} skipped_no_email=${noEmail}`);

  if (!dryRun) {
    await writeFile(outputPath, `${JSON.stringify(mapping, null, 2)}\n`, "utf8");
    console.log(`[import] mapping escrito en ${outputPath} (${Object.keys(mapping).length} entradas)`);
  } else {
    console.log("[import] dry-run: no se escribio nada");
  }
}

async function simulate(record: LegacyUserRecord): Promise<ImportOutcome> {
  if (!record.email || record.email.trim().length === 0) {
    return { status: "skipped_no_email", legacyUid: record.uid, authcoreUserId: null };
  }
  const { rows } = await pool.query('SELECT id FROM "user" WHERE email = $1 LIMIT 1', [record.email.trim()]);
  const existing = rows[0] ? (rows[0].id as string) : null;
  return existing
    ? { status: "skipped_existing", legacyUid: record.uid, authcoreUserId: existing }
    : { status: "created", legacyUid: record.uid, authcoreUserId: "(dry-run)" };
}

main()
  .then(async () => {
    await pool.end();
  })
  .catch(async (err) => {
    console.error("[import] failed:", err instanceof Error ? err.message : err);
    await pool.end();
    process.exit(1);
  });
