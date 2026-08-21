import { createAuthClient } from "better-auth/client";

/**
 * Client-facing facade for the auth module.
 *
 * Consuming UI code should depend on these functions only, not on Better Auth
 * internals. baseURL is omitted because the page is served from the same origin
 * as the auth API (/api/auth/*). No server secrets live here — this file is part
 * of the client bundle.
 */
const client = createAuthClient();

export async function signUp(input: {
  name: string;
  email: string;
  password: string;
}) {
  return client.signUp.email(input);
}
