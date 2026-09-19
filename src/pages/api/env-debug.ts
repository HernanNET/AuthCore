import type { APIRoute } from "astro";
import { env } from "@/lib/env";

/**
 * Temporary environment probe for debugging the test runtime selection.
 * Removed after the authcore-in-cloudflare migration stabilizes.
 */
export const GET: APIRoute = async () =>
  new Response(JSON.stringify({
    AUTH_ENV: env.AUTH_ENV,
    isTestMode: env.isTestMode,
    driver: env.AUTHCORE_DRIVER,
  }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
