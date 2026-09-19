import { Pool } from "pg";
import { neonConfig, Pool as NeonPool } from "@neondatabase/serverless";
import { env } from "./env";

/**
 * Shared server-only PostgreSQL pool for AuthCore and its security log.
 *
 * Local development, tests and migrations run on Node against a plain pg
 * connection. The deployed Workers build selects the Neon HTTP-compatible
 * pool through AUTHCORE_DRIVER=neon so pg's TCP sockets are never used in
 * the Cloudflare runtime.
 */
let driver: Pool | NeonPool;
if (env.AUTHCORE_DRIVER === "neon") {
  neonConfig.webSocketConstructor = globalThis.WebSocket as unknown as typeof WebSocket;
  driver = new NeonPool({ connectionString: env.DATABASE_URL });
} else {
  driver = new Pool({ connectionString: env.DATABASE_URL });
}

export const pool = driver as unknown as Pool;
