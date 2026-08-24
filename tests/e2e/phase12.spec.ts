import { test, expect, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import { cleanupTestUsers, closeDb, countPasskeysForUser, findUserByEmail } from "../helpers/db";
import { clearAllMailbox } from "../helpers/mailbox";
import { loginUser, registerAndVerifyUser } from "../helpers/auth-flow";

const BASE = process.env.AUTHCORE_TEST_URL ?? "http://localhost:4321";

type VirtualAuthenticator = { cdp: CDPSession; authenticatorId: string };

async function addVirtualAuthenticator(context: BrowserContext, page: Page): Promise<VirtualAuthenticator> {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

async function removeVirtualAuthenticator(authenticator: VirtualAuthenticator): Promise<void> {
  await authenticator.cdp.send("WebAuthn.removeVirtualAuthenticator", {
    authenticatorId: authenticator.authenticatorId,
  });
  await authenticator.cdp.send("WebAuthn.disable");
  await authenticator.cdp.detach();
}

async function enrollPasskey(context: BrowserContext, page: Page, name = "Test Windows PC") {
  const authenticator = await addVirtualAuthenticator(context, page);
  const email = await registerAndVerifyUser(page, "Passkey User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  await page.goto(`${BASE}/passkeys`);
  await page.fill("#passkey-name", name);
  await page.click("#add-button");
  await expect(page.locator("#success-message")).toContainText("added successfully");
  await expect(page.locator("#passkey-list li")).toHaveCount(1);
  return { email, authenticator };
}

test.beforeAll(async () => { await cleanupTestUsers(); await clearAllMailbox(); });
test.afterAll(async () => { await cleanupTestUsers(); await clearAllMailbox(); await closeDb(); });

test("1 — anonymous passkey management access is denied", async ({ page }) => {
  await page.goto(`${BASE}/passkeys`);
  await page.waitForURL(/\/login/);
});

test("2 — account exposes passkey navigation", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Passkey Link User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  await expect(page.locator("#passkeys-link")).toHaveAttribute("href", "/passkeys");
});

test("3 — a verified user can register and list a passkey", async ({ context, page }) => {
  const { email, authenticator } = await enrollPasskey(context, page);
  const user = await findUserByEmail(email);
  expect(user).not.toBeNull();
  expect(await countPasskeysForUser(user.id)).toBe(1);
  await expect(page.locator(".passkey-title")).toHaveText("Test Windows PC");
  await removeVirtualAuthenticator(authenticator);
});

test("4 — a user can rename a passkey", async ({ context, page }) => {
  const { authenticator } = await enrollPasskey(context, page, "Old name");
  page.once("dialog", async (dialog) => dialog.accept("Windows Hello"));
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.locator(".passkey-title")).toHaveText("Windows Hello");
  await removeVirtualAuthenticator(authenticator);
});

test("5 — a registered passkey signs in without a password", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const { email, authenticator } = await enrollPasskey(context, page);
  await page.goto(`${BASE}/account`);
  await page.click("#signout-button");
  await page.waitForURL(/\/login/);
  await page.click("#passkey-button");
  await page.waitForURL(/\/account/);
  await expect(page.locator("#user-email")).toHaveText(email);
  await removeVirtualAuthenticator(authenticator);
  await context.close();
});

test("6 — deleting a passkey removes it from the account", async ({ context, page }) => {
  const { email, authenticator } = await enrollPasskey(context, page, "Disposable key");
  page.once("dialog", async (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("#empty-message")).toBeVisible();
  const user = await findUserByEmail(email);
  expect(await countPasskeysForUser(user.id)).toBe(0);
  await removeVirtualAuthenticator(authenticator);
});
