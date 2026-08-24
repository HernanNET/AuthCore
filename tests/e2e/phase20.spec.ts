import { test, expect } from "@playwright/test";
import {
  resolveClientIp,
  withTrustedClientIp,
} from "../../src/lib/client-ip";
import { validateRuntimeConfig } from "../../src/lib/env";

const validConfig = {
  authEnvironment: "production" as const,
  baseURL: "https://auth.socialdrinking.it",
  secret: "a".repeat(32),
  proxyMode: "cloudflare",
  googleClientId: "client-id",
  googleClientSecret: "client-secret",
};

test("1 — readiness endpoint confirms database access without metadata", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(JSON.parse(body)).toEqual({ status: "ok" });
  expect(body).not.toContain("DATABASE_URL");
});

test("2 — readiness HEAD is bodyless and receives no-store protection", async ({ request }) => {
  const response = await request.head("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.body()).toHaveLength(0);
  expect(response.headers()["cache-control"]).toBe("no-store, max-age=0");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
});

test("3 — production requires a public HTTPS origin", () => {
  for (const baseURL of ["http://auth.socialdrinking.it", "https://localhost:4321"]) {
    expect(() => validateRuntimeConfig({ ...validConfig, baseURL })).toThrow(
      "Production BETTER_AUTH_URL must use HTTPS and a non-loopback host.",
    );
  }
  expect(validateRuntimeConfig(validConfig)).toMatchObject({
    origin: "https://auth.socialdrinking.it",
    secureOrigin: true,
    proxyMode: "cloudflare",
  });
});

test("4 — startup validation rejects weak or half-configured credentials", () => {
  expect(() => validateRuntimeConfig({ ...validConfig, secret: "too-short" })).toThrow(
    "BETTER_AUTH_SECRET must contain at least 32 characters.",
  );
  expect(() =>
    validateRuntimeConfig({ ...validConfig, googleClientSecret: "" }),
  ).toThrow("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together.");
});

test("5 — direct mode accepts a validated socket address", () => {
  expect(
    resolveClientIp({
      headers: new Headers(),
      directAddress: "::ffff:127.0.0.1",
      proxyMode: "direct",
    }),
  ).toBe("127.0.0.1");
});

test("6 — direct mode rejects spoofed forwarding headers", () => {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.9" });
  expect(
    resolveClientIp({ headers, directAddress: "127.0.0.1", proxyMode: "direct" }),
  ).toBeNull();
});

test("7 — Cloudflare mode accepts one valid address and rejects header chains", () => {
  expect(
    resolveClientIp({
      headers: new Headers({ "cf-connecting-ip": "2001:db8::1" }),
      directAddress: "198.51.100.2",
      proxyMode: "cloudflare",
    }),
  ).toBe("2001:db8::1");
  expect(
    resolveClientIp({
      headers: new Headers({ "cf-connecting-ip": "203.0.113.9, 198.51.100.2" }),
      directAddress: "198.51.100.2",
      proxyMode: "cloudflare",
    }),
  ).toBeNull();
});

test("8 — browser input cannot set AuthCore's internal client-IP header", async () => {
  const original = new Request("http://localhost/api/auth/get-session", {
    headers: { "x-authcore-client-ip": "203.0.113.250" },
  });
  const removed = withTrustedClientIp(original, null);
  expect(removed.headers.has("x-authcore-client-ip")).toBe(false);

  const replaced = withTrustedClientIp(original, "127.0.0.1");
  expect(replaced.headers.get("x-authcore-client-ip")).toBe("127.0.0.1");
});
