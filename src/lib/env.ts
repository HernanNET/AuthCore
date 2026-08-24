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

function requiredInt(name: string, fallback?: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(
      `Missing required server environment variable: ${name}. ` +
        `Loaded from "${envFile}". See .env.example.`,
    );
  }
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) {
    throw new Error(
      `Invalid value for ${name}: "${raw}". Must be a positive integer.`,
    );
  }
  return n;
}

/** Optional string — returns empty string if unset (for optional config like OAuth). */
function optional(name: string): string {
  return process.env[name] ?? "";
}

export const env = {
  AUTH_ENV: process.env.AUTH_ENV ?? "development",
  BETTER_AUTH_SECRET: required("BETTER_AUTH_SECRET"),
  // Playwright may use an alternate local port when a manual dev server is open.
  // This test-only override never changes the database or secret selected above.
  BETTER_AUTH_URL:
    process.env.AUTH_ENV === "test" && process.env.AUTHCORE_TEST_URL
      ? process.env.AUTHCORE_TEST_URL
      : required("BETTER_AUTH_URL"),
  DATABASE_URL: required("DATABASE_URL"),
  EMAIL_VERIFICATION_EXPIRES_IN_SECONDS: requiredInt(
    "EMAIL_VERIFICATION_EXPIRES_IN_SECONDS",
    3600,
  ),
  PASSWORD_RESET_EXPIRES_IN_SECONDS: requiredInt(
    "PASSWORD_RESET_EXPIRES_IN_SECONDS",
    3600,
  ),
  ACCOUNT_DELETION_EXPIRES_IN_SECONDS: requiredInt(
    "ACCOUNT_DELETION_EXPIRES_IN_SECONDS",
    3600,
  ),
  GOOGLE_CLIENT_ID: optional("GOOGLE_CLIENT_ID"),
  GOOGLE_CLIENT_SECRET: optional("GOOGLE_CLIENT_SECRET"),
  /** True only when AUTH_ENV === "test". Test-only endpoints fail closed otherwise. */
  isTestMode: process.env.AUTH_ENV === "test",
} as const;
