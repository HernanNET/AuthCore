import { test, expect } from "@playwright/test";
import {
  applySecurityHeaders,
  isSensitivePath,
} from "../../src/lib/security-headers";

const BASE = process.env.AUTHCORE_TEST_URL ?? "http://localhost:4321";

test("1 — every public page receives the browser hardening headers", async ({ request }) => {
  const response = await request.get("/login");
  expect(response.status()).toBe(200);
  const headers = response.headers();

  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");
  expect(headers["x-dns-prefetch-control"]).toBe("off");
});

test("2 — CSP denies dangerous defaults and framing", async ({ request }) => {
  const response = await request.get("/register");
  const csp = response.headers()["content-security-policy"];

  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("base-uri 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("form-action 'self'");
});

test("3 — HSTS is HTTPS-only and localhost is never pinned", async ({ request }) => {
  const response = await request.get("/login");
  expect(response.headers()["strict-transport-security"]).toBeUndefined();

  const headers = new Headers();
  applySecurityHeaders(headers, { secureTransport: true, sensitive: false });
  expect(headers.get("strict-transport-security")).toBe(
    "max-age=31536000; includeSubDomains",
  );
  applySecurityHeaders(headers, { secureTransport: false, sensitive: false });
  expect(headers.has("strict-transport-security")).toBe(false);
});

test("4 — authentication surfaces cannot be cached", async ({ request }) => {
  for (const path of ["/login", "/register", "/api/auth/get-session"]) {
    const response = await request.get(path);
    expect(response.headers()["cache-control"]).toBe("no-store, max-age=0");
    expect(response.headers().pragma).toBe("no-cache");
  }

  expect(isSensitivePath("/account")).toBe(true);
  expect(isSensitivePath("/api/auth/get-session")).toBe(true);
  expect(isSensitivePath("/_astro/client.js")).toBe(false);
});

test("5 — Permissions Policy keeps same-origin passkeys available", async ({ request }) => {
  const response = await request.get("/passkeys");
  const policy = response.headers()["permissions-policy"];

  expect(policy).toContain("camera=()");
  expect(policy).toContain("microphone=()");
  expect(policy).toContain("publickey-credentials-create=(self)");
  expect(policy).toContain("publickey-credentials-get=(self)");
  expect(policy).not.toContain("publickey-credentials-get=()");
});

test("6 — CSP remains compatible with AuthCore client validation", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill("not-an-email");
  await page.locator("#password").fill("irrelevant-password");
  await page.locator("#login-button").click();

  await expect(page.locator("#error-message")).toHaveText(
    "Please enter a valid email address.",
  );
  await expect(page).toHaveURL(`${BASE}/login`);
});

test("7 — untrusted origins are rejected without leaking secrets", async ({ request }) => {
  const response = await request.post("/api/auth/sign-in/email", {
    headers: {
      origin: "https://attacker.example",
      "content-type": "application/json",
    },
    data: { email: "nobody@example.test", password: "irrelevant-password" },
  });

  expect(response.status()).toBe(403);
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  const serializedHeaders = JSON.stringify(response.headers()).toLowerCase();
  expect(serializedHeaders).not.toContain("better_auth_secret");
  expect(serializedHeaders).not.toContain("database_url");
  expect(serializedHeaders).not.toContain("google_client_secret");
});
