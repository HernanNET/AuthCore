import { test, expect, type Page } from "@playwright/test";
import {
  cleanupTestUsers,
  closeDb,
  countSessionsForUser,
  findUserByEmail,
  securityEventTypesForUser,
  setUserRole,
} from "../helpers/db";
import { clearAllMailbox } from "../helpers/mailbox";
import {
  DEFAULT_PASSWORD,
  loginUser,
  registerAndVerifyUser,
  uniqueEmail,
} from "../helpers/auth-flow";

const BASE = process.env.AUTHCORE_TEST_URL ?? "http://localhost:4321";

test.beforeEach(async () => { await cleanupTestUsers(); await clearAllMailbox(); });
test.afterEach(async () => { await cleanupTestUsers(); await clearAllMailbox(); });
test.afterAll(async () => { await closeDb(); });

async function createAdmin(page: Page, name = "Phase Twenty Five Admin") {
  const email = await registerAndVerifyUser(page, name);
  await setUserRole(email, "admin");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  const user = await findUserByEmail(email);
  return { email, user };
}

async function acceptNextDialog(page: Page) {
  page.once("dialog", async (dialog) => dialog.accept());
}

async function createManagedUserViaUi(adminPage: Page, options: {
  name: string;
  email: string;
  password?: string;
  role?: "user" | "seller" | "admin";
  emailVerified?: boolean;
}) {
  await adminPage.goto(`${BASE}/admin/users/new`);
  await adminPage.fill("#name", options.name);
  await adminPage.fill("#email", options.email);
  await adminPage.fill("#password", options.password ?? DEFAULT_PASSWORD);
  await adminPage.selectOption("#role", options.role ?? "user");
  if (options.emailVerified === false) {
    await adminPage.uncheck("#email-verified");
  }
  await adminPage.click('button[type="submit"]');
  await adminPage.waitForURL(/\/admin$/);
}

async function openManagedUser(adminPage: Page, email: string) {
  await adminPage.goto(`${BASE}/admin?field=email&q=${encodeURIComponent(email)}`);
  await adminPage.locator(`tr[data-user-email="${email}"] a[href^="/admin/users/"]`).click();
  await adminPage.waitForURL(/\/admin\/users\//);
}

test("1 — an administrator can create a user with a role and verified email", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await createAdmin(adminPage);

  const email = uniqueEmail();
  await createManagedUserViaUi(adminPage, {
    name: "Created By Admin",
    email,
    role: "seller",
    emailVerified: true,
  });

  const created = await findUserByEmail(email);
  expect(created).not.toBeNull();
  expect(created.role).toBe("seller");
  expect(created.emailVerified).toBe(true);
  expect(await securityEventTypesForUser(created.id)).toContain("admin_user_created");
  await adminContext.close();
});

test("2 — an administrator can edit a user's profile", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await createAdmin(adminPage);

  const email = uniqueEmail();
  await createManagedUserViaUi(adminPage, { name: "Before Edit", email, emailVerified: true });
  await openManagedUser(adminPage, email);

  await adminPage.fill("#name", "After Edit");
  await adminPage.click('#profile-form button[type="submit"]');

  await expect.poll(async () => (await findUserByEmail(email))?.name).toBe("After Edit");
  const edited = await findUserByEmail(email);
  await expect.poll(async () => securityEventTypesForUser(edited.id)).toContain("admin_user_updated");
  await adminContext.close();
});

test("3 — an administrator can change a user's role and set a new password", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await createAdmin(adminPage);

  const targetContext = await browser.newContext();
  const targetPage = await targetContext.newPage();
  const email = uniqueEmail();
  await createManagedUserViaUi(adminPage, { name: "Role Target", email, role: "seller", emailVerified: true });
  await openManagedUser(adminPage, email);

  await adminPage.selectOption("#role", "user");
  await adminPage.click('#role-form button[type="submit"]');
  await expect.poll(async () => (await findUserByEmail(email))?.role).toBe("user");

  const newPassword = "N3wAdm!nPass!";
  await adminPage.fill("#new-password", newPassword);
  await adminPage.click('#password-form button[type="submit"]');
  await expect(adminPage.locator("#form-message")).toContainText("Password updated");

  const target = await findUserByEmail(email);
  await expect.poll(async () => securityEventTypesForUser(target.id)).toContain("admin_role_changed");
  await expect.poll(async () => securityEventTypesForUser(target.id)).toContain("admin_password_set");

  await loginUser(targetPage, email, newPassword);
  await targetPage.waitForURL(/\/account/);
  await targetContext.close();
  await adminContext.close();
});

test("4 — an administrator can revoke all sessions of a user", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await createAdmin(adminPage);

  const firstContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  const email = uniqueEmail();
  await createManagedUserViaUi(adminPage, { name: "Session Target", email, emailVerified: true });

  await loginUser(firstPage, email);
  await firstPage.waitForURL(/\/account/);
  await loginUser(secondPage, email);
  await secondPage.waitForURL(/\/account/);
  const target = await findUserByEmail(email);
  expect(await countSessionsForUser(target.id)).toBe(2);

  await openManagedUser(adminPage, email);
  await acceptNextDialog(adminPage);
  await adminPage.click("#revoke-all");
  await expect.poll(() => countSessionsForUser(target.id)).toBe(0);
  await expect.poll(async () => securityEventTypesForUser(target.id)).toContain("admin_sessions_revoked");

  await firstPage.goto(`${BASE}/account`);
  await expect(firstPage).toHaveURL(/\/login$/);
  await firstContext.close();
  await secondContext.close();
  await adminContext.close();
});

test("5 — an administrator can delete a user", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const admin = await createAdmin(adminPage);

  const email = uniqueEmail();
  await createManagedUserViaUi(adminPage, { name: "Delete Target", email, emailVerified: true });
  await openManagedUser(adminPage, email);

  await acceptNextDialog(adminPage);
  await adminPage.click("#delete-user");
  await adminPage.waitForURL(/\/admin$/);
  expect(await findUserByEmail(email)).toBeNull();
  // The deletion is audited on the acting administrator's activity log.
  expect(await securityEventTypesForUser(admin.user.id)).toContain("admin_user_deleted");
  await adminContext.close();
});

test("6 — protected accounts reject destructive admin actions server-side", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const admin = await createAdmin(adminPage);

  const otherAdminContext = await browser.newContext();
  const otherAdminPage = await otherAdminContext.newPage();
  const otherAdminEmail = await registerAndVerifyUser(otherAdminPage, "Second Protected Admin");
  await setUserRole(otherAdminEmail, "admin");
  await loginUser(otherAdminPage, otherAdminEmail);
  await otherAdminPage.waitForURL(/\/account/);
  const otherAdmin = await findUserByEmail(otherAdminEmail);

  const statuses = await adminPage.evaluate(async (ids) => {
    const run = async (path: string, body: unknown) => {
      const response = await fetch(`/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return response.status;
    };
    return {
      setRoleOtherAdmin: await run("/admin/set-role", { userId: ids.otherAdminId, role: "user" }),
      removeOtherAdmin: await run("/admin/remove-user", { userId: ids.otherAdminId }),
      banOtherAdmin: await run("/admin/ban-user", { userId: ids.otherAdminId }),
      setRoleSelf: await run("/admin/set-role", { userId: ids.selfId, role: "user" }),
      removeSelf: await run("/admin/remove-user", { userId: ids.selfId }),
    };
  }, { selfId: admin.user.id, otherAdminId: otherAdmin.id });

  expect(statuses.setRoleOtherAdmin).toBe(400);
  expect(statuses.removeOtherAdmin).toBe(400);
  expect(statuses.banOtherAdmin).toBe(400);
  expect(statuses.setRoleSelf).toBe(400);
  expect(statuses.removeSelf).toBe(400);

  expect((await findUserByEmail(admin.email)).role).toBe("admin");
  expect((await findUserByEmail(otherAdminEmail)).role).toBe("admin");
  expect((await findUserByEmail(otherAdminEmail)).banned).toBe(false);
  await adminContext.close();
  await otherAdminContext.close();
});