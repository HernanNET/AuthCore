import dotenv from "dotenv";

/**
 * Server-only environment loader.
 *
 * The file selected depends on AUTH_ENV:
 *   - AUTH_ENV=test  -> .env.test  (dedicated test database / separate secret)
 *   - anything else -> .env        (development)
 *
 * AUTH_ENV is a custom var (not NODE_ENV) so Vite never statically replaces it
 * in the SSR bundle. `override: true` guarantees the chosen file wins even if a
 * parent process already injected values.
 */
const envFile = process.env.AUTH_ENV === "test" ? ".env.test" : ".env";
dotenv.config({ path: envFile, override: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required server environment variable: ${name}. ` +
        `Loaded from "${envFile}". See .env.example.`,
    );
  }
  return value;
}

export const env = {
  AUTH_ENV: process.env.AUTH_ENV ?? "development",
  BETTER_AUTH_SECRET: required("BETTER_AUTH_SECRET"),
  BETTER_AUTH_URL: required("BETTER_AUTH_URL"),
  DATABASE_URL: required("DATABASE_URL"),
} as const;
