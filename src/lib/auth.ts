import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { env } from "./env";

/**
 * Better Auth server instance.
 *
 * The auth module owns this PostgreSQL connection and the tables it manages:
 *   user, account, session, verification (+ any internal tables Better Auth
 *   requires). No second user database is used.
 *
 * Phase 1 scope: registration only. `autoSignIn` is disabled so a successful
 * sign-up creates the user + credential account but does NOT establish a
 * session. Login / verification / OAuth come in later phases.
 */
export const pool = new Pool({ connectionString: env.DATABASE_URL });

export const auth = betterAuth({
  appName: "AuthCore",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: pool,
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
});

export type Auth = typeof auth;
