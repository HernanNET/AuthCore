import type { APIRoute } from "astro";
import { auth } from "@/lib/auth";

/**
 * Better Auth catch-all handler. Mounts the full auth API under /api/auth/*.
 * Better Auth validates methods and bodies, and rejects malformed requests.
 */
export const ALL: APIRoute = async (ctx) => {
  return auth.handler(ctx.request);
};
