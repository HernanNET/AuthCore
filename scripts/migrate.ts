import { getMigrations } from "better-auth/db/migration";
import { auth, pool } from "../src/lib/auth";

/**
 * Programmatic Better Auth migration.
 *
 * Loads the env file selected by AUTH_ENV (see src/lib/env.ts) and applies the
 * core schema (user, account, session, verification) to the targeted database.
 *
 *   pnpm db:migrate        -> .env       (development database)
 *   pnpm db:migrate:test   -> .env.test  (test database)
 */
async function main(): Promise<void> {
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  console.log("[authcore] migrations applied.");
  if (toBeCreated?.length) {
    console.log("[authcore] tables to be created:", toBeCreated.length);
  }
  if (toBeAdded?.length) {
    console.log("[authcore] columns to be added:", toBeAdded.length);
  }
  await pool.end();
}

main().catch((err) => {
  console.error("[authcore] migration failed:", err);
  process.exit(1);
});
