import { test, expect } from "@playwright/test";

/**
 * Test 14 — production mailbox isolation.
 *
 * This runs against a DEV-mode server (AUTH_ENV=development) on port 4322.
 * The test-only captured-mailbox endpoint must return 404 (route unavailable)
 * when AUTH_ENV !== "test". Production fails closed.
 */
test("14 — test mailbox endpoint blocked in production mode", async () => {
  const res = await fetch("http://127.0.0.1:4322/api/test/captured-verification-emails?to=any@example.test");
  expect(res.status).toBe(404);
});
