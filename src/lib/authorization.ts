import type { Pool } from "pg";

/**
 * Normalize authorization fields added by Better Auth's Admin plugin.
 * The native migration adds nullable columns, so accounts created in earlier
 * phases need an explicit least-privilege backfill.
 */
export async function ensureAuthorizationDefaults(database: Pool): Promise<void> {
  await database.query(`
    UPDATE "user"
    SET role = 'user'
    WHERE role IS NULL OR BTRIM(role) = '';

    UPDATE "user"
    SET banned = FALSE
    WHERE banned IS NULL;

    ALTER TABLE "user"
      ALTER COLUMN role SET DEFAULT 'user',
      ALTER COLUMN banned SET DEFAULT FALSE;
  `);
}
