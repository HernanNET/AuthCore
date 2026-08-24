import type { APIRoute } from "astro";
import { env } from "@/lib/env";
import { getCapturedEmails } from "@/lib/email";

/**
 * TEST-ONLY endpoint to retrieve captured verification emails.
 *
 * Server-side gate: returns 404 (route unavailable) whenever AUTH_ENV !== "test".
 * This is a hard server-side check, not a UI hide. Production fails closed.
 *
 *   GET /api/test/captured-verification-emails?to=<email>
 *
 * Scopes retrieval by recipient. Never exposes messages for other recipients.
 */
export const GET: APIRoute = async (ctx) => {
  if (!env.isTestMode) {
    return new Response("Not Found", { status: 404 });
  }

  const to = new URL(ctx.request.url).searchParams.get("to");
  if (!to) {
    return new Response(JSON.stringify({ error: "Missing 'to' parameter" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const messages = getCapturedEmails(to);
  return new Response(JSON.stringify({ messages }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
