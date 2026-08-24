import type { APIRoute } from "astro";
import { pool } from "@/lib/database";

function healthResponse(status: "ok" | "unavailable", httpStatus: 200 | 503) {
  return new Response(JSON.stringify({ status }), {
    status: httpStatus,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const GET: APIRoute = async () => {
  try {
    await pool.query("SELECT 1");
    return healthResponse("ok", 200);
  } catch {
    return healthResponse("unavailable", 503);
  }
};

export const HEAD: APIRoute = async () => {
  try {
    await pool.query("SELECT 1");
    return new Response(null, { status: 200 });
  } catch {
    return new Response(null, { status: 503 });
  }
};
