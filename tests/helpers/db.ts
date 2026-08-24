import { Pool } from "pg";

/**
 * Test-only PostgreSQL access for DB assertions.
 * Always connects to the TEST database (authcore_test). Never touches dev/prod.
 *
 * The pool is lazily recreated if it has been closed (e.g. by another test
 * file's afterAll), so multiple test files can share the same module safely.
 */
const TEST_DB_URL = "postgres://authcore:authcore_dev@localhost:5432/authcore_test";

let _db: Pool | null = null;

function getDb(): Pool {
  if (!_db || _db.ended) {
    _db = new Pool({ connectionString: TEST_DB_URL });
  }
  return _db;
}

export const db = {
  query(text: string, params?: unknown[]) {
    return getDb().query(text, params as never[]);
  },
};

/** Find a user by email in the test database. */
export async function findUserByEmail(email: string) {
  const { rows } = await db.query(
    'SELECT id, name, email, "emailVerified", "twoFactorEnabled", role, banned FROM "user" WHERE email = $1',
    [email.toLowerCase()],
  );
  return rows[0] ?? null;
}

/** Test-only role assignment used to establish authorization fixtures. */
export async function setUserRole(email: string, role: "user" | "admin"): Promise<void> {
  await db.query(
    'UPDATE "user" SET role = $1, "updatedAt" = NOW() WHERE email = $2',
    [role, email.toLowerCase()],
  );
}

/** Count sessions for a user id. */
export async function countSessionsForUser(userId: string): Promise<number> {
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS count FROM session WHERE \"userId\" = $1",
    [userId],
  );
  return rows[0].count;
}

/** Count accounts for a user id. */
export async function countAccountsForUser(userId: string): Promise<number> {
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS count FROM account WHERE \"userId\" = $1",
    [userId],
  );
  return rows[0].count;
}

/** Count passkeys for a user id. */
export async function countPasskeysForUser(userId: string): Promise<number> {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS count FROM passkey WHERE "userId" = $1',
    [userId],
  );
  return rows[0].count;
}

/** Get credential account for a user id. */
export async function getCredentialAccount(userId: string) {
  const { rows } = await db.query(
    'SELECT id, "providerId", "accountId", issuer, password FROM account WHERE "userId" = $1 AND "providerId" = $2',
    [userId, "credential"],
  );
  return rows[0] ?? null;
}

/** Count all users in the test database. */
export async function countAllUsers(): Promise<number> {
  const { rows } = await db.query('SELECT COUNT(*)::int AS count FROM "user"');
  return rows[0].count;
}

/** Count all sessions in the test database. */
export async function countAllSessions(): Promise<number> {
  const { rows } = await db.query("SELECT COUNT(*)::int AS count FROM session");
  return rows[0].count;
}

/** Count all accounts in the test database. */
export async function countAllAccounts(): Promise<number> {
  const { rows } = await db.query("SELECT COUNT(*)::int AS count FROM account");
  return rows[0].count;
}

/** Count verification records in the test database. */
export async function countAllVerifications(): Promise<number> {
  const { rows } = await db.query("SELECT COUNT(*)::int AS count FROM verification");
  return rows[0].count;
}

/** Count all persisted rate-limit buckets in the test database. */
export async function countAllRateLimits(): Promise<number> {
  const { rows } = await db.query('SELECT COUNT(*)::int AS count FROM "rateLimit"');
  return rows[0].count;
}

/** List security event types for one user, newest first. */
export async function securityEventTypesForUser(userId: string): Promise<string[]> {
  const { rows } = await db.query(
    'SELECT type FROM "securityEvent" WHERE "userId" = $1 ORDER BY "createdAt" DESC',
    [userId],
  );
  return rows.map((row) => row.type);
}

/** Count security events for one user. */
export async function countSecurityEventsForUser(userId: string): Promise<number> {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS count FROM "securityEvent" WHERE "userId" = $1',
    [userId],
  );
  return rows[0].count;
}

/** Count pending native account-deletion tokens for a user. */
export async function countAccountDeletionTokens(userId: string): Promise<number> {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS count FROM verification WHERE identifier LIKE $1 AND value = $2',
    ["delete-account-%", userId],
  );
  return rows[0].count;
}

/** Delete a user and all related data (accounts, sessions) by email. */
export async function deleteUserByEmail(email: string): Promise<void> {
  const lower = email.toLowerCase();
  await db.query('DELETE FROM verification WHERE value IN (SELECT id FROM "user" WHERE email = $1)', [lower]);
  await db.query('DELETE FROM passkey WHERE "userId" IN (SELECT id FROM "user" WHERE email = $1)', [lower]);
  await db.query('DELETE FROM session WHERE "userId" IN (SELECT id FROM "user" WHERE email = $1)', [lower]);
  await db.query('DELETE FROM account WHERE "userId" IN (SELECT id FROM "user" WHERE email = $1)', [lower]);
  await db.query('DELETE FROM verification WHERE identifier = $1', [lower]);
  await db.query('DELETE FROM "user" WHERE email = $1', [lower]);
}

/** Clean up all playwright test users. */
export async function cleanupTestUsers(): Promise<void> {
  await db.query('DELETE FROM "rateLimit"');
  // Pending 2FA challenge counters store an attempt count rather than userId,
  // so they must be removed by their native identifier prefix.
  await db.query('DELETE FROM verification WHERE identifier LIKE $1', ["2fa-%"]);
  await db.query('DELETE FROM verification WHERE value IN (SELECT id FROM "user" WHERE email LIKE $1)', ["playwright-%@example.test"]);
  await db.query('DELETE FROM passkey WHERE "userId" IN (SELECT id FROM "user" WHERE email LIKE $1)', ["playwright-%@example.test"]);
  await db.query('DELETE FROM session WHERE "userId" IN (SELECT id FROM "user" WHERE email LIKE $1)', ["playwright-%@example.test"]);
  await db.query('DELETE FROM account WHERE "userId" IN (SELECT id FROM "user" WHERE email LIKE $1)', ["playwright-%@example.test"]);
  await db.query("DELETE FROM verification WHERE identifier LIKE $1", ["playwright-%@example.test"]);
  await db.query('DELETE FROM "user" WHERE email LIKE $1', ["playwright-%@example.test"]);
}

/** Expire every pending password-reset token owned by a user. */
export async function expirePasswordResetTokens(userId: string): Promise<void> {
  await db.query(
    'UPDATE verification SET "expiresAt" = NOW() - INTERVAL \'1 second\' WHERE identifier LIKE $1 AND value = $2',
    ["reset-password:%", userId],
  );
}

/** Close the pool. Safe to call multiple times. */
export async function closeDb(): Promise<void> {
  if (_db && !_db.ended) {
    await _db.end();
  }
}
