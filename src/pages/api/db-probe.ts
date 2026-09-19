import type { APIRoute } from "astro";
import { pool } from "@/lib/database";

/**
 * Test-only database probe for the Workers runtime (drives the same pool
 * Better Auth uses). Exercises a plain query and a transaction so a runtime
 * transport failure can be isolated to one of the two paths.
 */
export const GET: APIRoute = async () => {
  const steps: Array<Record<string, unknown>> = [];
  try {
    const started = Date.now();
    const simple = await pool.query("SELECT 1 AS one");
    steps.push({ step: "query", ms: Date.now() - started, rows: simple.rowCount });

    const txStarted = Date.now();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const probe = await client.query("SELECT COUNT(*)::int AS n FROM \"user\"");
      await client.query("COMMIT");
      steps.push({ step: "transaction", ms: Date.now() - txStarted, users: probe.rows?.[0]?.n ?? null });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      steps.push({ step: "transaction_error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      client.release();
    }
    return new Response(JSON.stringify({ ok: true, steps }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    steps.push({ step: "fatal", message: error instanceof Error ? error.message : String(error) });
    return new Response(JSON.stringify({ ok: false, steps }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
};
