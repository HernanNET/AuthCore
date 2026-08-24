import type { APIRoute } from "astro";
import { env } from "@/lib/env";
import { clearAllCapturedEmails } from "@/lib/email";

/**
 * TEST-ONLY endpoint to clear all captured verification emails.
 *
 * Server-side gate: returns 404 whenever AUTH_ENV !== "test".
 * Production fails closed.
 *
 *   POST /api/test/clear-captured-verification-emails
 */
export const POST: APIRoute = async () => {
  if (!env.isTestMode) {
    return new Response("Not Found", { status: 404 });
  }
  clearAllCapturedEmails();
  return new Response(JSON.stringify({ status: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
