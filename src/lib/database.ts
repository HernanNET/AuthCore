import { Pool } from "pg";
import { env } from "./env";

/** Shared server-only PostgreSQL pool for AuthCore and its security log. */
export const pool = new Pool({ connectionString: env.DATABASE_URL });
