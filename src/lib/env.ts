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
const AUTH_ENV_VALUES = ["development", "test", "production"] as const;
type AuthEnvironment = (typeof AUTH_ENV_VALUES)[number];

const rawAuthEnv = process.env.AUTH_ENV ?? "development";
if (!AUTH_ENV_VALUES.includes(rawAuthEnv as AuthEnvironment)) {
  throw new Error(
    `Invalid AUTH_ENV: "${rawAuthEnv}". Expected development, test, or production.`,
  );
}
const authEnvironment = rawAuthEnv as AuthEnvironment;
const envFile = authEnvironment === "test" ? ".env.test" : ".env";

// Production receives secrets from the deployment platform. Loading a local
// file there could silently replace a rotated secret with a developer value.
if (authEnvironment !== "production") {
  dotenv.config({ path: envFile, override: true });
}

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

export function validateRuntimeConfig(input: {
  authEnvironment: AuthEnvironment;
  baseURL: string;
  secret: string;
  proxyMode: string;
  googleClientId: string;
  googleClientSecret: string;
}): { origin: string; secureOrigin: boolean; proxyMode: "direct" | "cloudflare" } {
  let url: URL;
  try {
    url = new URL(input.baseURL);
  } catch {
    throw new Error("BETTER_AUTH_URL must be a valid absolute URL.");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("BETTER_AUTH_URL must contain only the public origin.");
  }
  if (!(["direct", "cloudflare"] as const).includes(input.proxyMode as "direct" | "cloudflare")) {
    throw new Error('AUTHCORE_PROXY_MODE must be either "direct" or "cloudflare".');
  }
  if (input.secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }
  if (Boolean(input.googleClientId) !== Boolean(input.googleClientSecret)) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together.");
  }
  if (input.authEnvironment === "production") {
    const loopback = new Set(["localhost", "127.0.0.1", "::1"]);
    if (url.protocol !== "https:" || loopback.has(url.hostname)) {
      throw new Error("Production BETTER_AUTH_URL must use HTTPS and a non-loopback host.");
    }
  }
  return {
    origin: url.origin,
    secureOrigin: url.protocol === "https:",
    proxyMode: input.proxyMode as "direct" | "cloudflare",
  };
}

const betterAuthURL =
  authEnvironment === "test" && process.env.AUTHCORE_TEST_URL
    ? process.env.AUTHCORE_TEST_URL
    : required("BETTER_AUTH_URL");
const googleClientId = optional("GOOGLE_CLIENT_ID");
const googleClientSecret = optional("GOOGLE_CLIENT_SECRET");
const runtime = validateRuntimeConfig({
  authEnvironment,
  baseURL: betterAuthURL,
  secret: required("BETTER_AUTH_SECRET"),
  proxyMode: optional("AUTHCORE_PROXY_MODE") || "direct",
  googleClientId,
  googleClientSecret,
});

/**
 * Optional, comma-separated list of additional first-party origins allowed to
 * call the auth API (e.g. an admin panel served from another subdomain).
 * Each entry must be an absolute origin only; duplicates of the auth origin
 * are discarded. In production every entry must be HTTPS on a non-loopback
 * host, matching the runtime rules for BETTER_AUTH_URL.
 */
const rawTrustedOrigins = optional("AUTHCORE_TRUSTED_ORIGINS");
const AUTHCORE_TRUSTED_ORIGINS: string[] = Array.from(
      new Set(
        rawTrustedOrigins
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .map((value) => {
            let parsed: URL;
            try {
              parsed = new URL(value);
            } catch {
              throw new Error(
                `Invalid AUTHCORE_TRUSTED_ORIGINS entry: "${value}". Each entry must be an absolute URL origin.`,
              );
            }
            if (
              parsed.username ||
              parsed.password ||
              parsed.search ||
              parsed.hash ||
              parsed.pathname !== "/"
            ) {
              throw new Error(
                `Invalid AUTHCORE_TRUSTED_ORIGINS entry: "${value}". Entries must contain only the origin.`,
              );
            }
            if (authEnvironment === "production") {
              const loopback = new Set(["localhost", "127.0.0.1", "::1"]);
              if (parsed.protocol !== "https:" || loopback.has(parsed.hostname)) {
                throw new Error(
                  `Invalid AUTHCORE_TRUSTED_ORIGINS entry: "${value}". Production entries must use HTTPS on a non-loopback host.`,
                );
              }
            }
            return parsed.origin;
          }),
      ),
    )
    .filter((origin) => origin !== runtime.origin);

export const env = {
  AUTH_ENV: authEnvironment,
  BETTER_AUTH_SECRET: required("BETTER_AUTH_SECRET"),
  // Playwright may use an alternate local port when a manual dev server is open.
  // This test-only override never changes the database or secret selected above.
  BETTER_AUTH_URL: betterAuthURL,
  BETTER_AUTH_ORIGIN: runtime.origin,
  AUTHCORE_TRUSTED_ORIGINS,
  AUTHCORE_PROXY_MODE: runtime.proxyMode,
  isSecureOrigin: runtime.secureOrigin,
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
  GOOGLE_CLIENT_ID: googleClientId,
  GOOGLE_CLIENT_SECRET: googleClientSecret,
  /** True only when AUTH_ENV === "test". Test-only endpoints fail closed otherwise. */
  isTestMode: authEnvironment === "test",
} as const;
