import { createAuthClient } from "better-auth/client";
import { adminClient, twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { authAccessControl, authRoles } from "./access-control";

/**
 * Client-facing facade for the auth module.
 *
 * Consuming UI code should depend on these functions only, not on Better Auth
 * internals. baseURL is omitted because the page is served from the same origin
 * as the auth API (/api/auth/*). No server secrets live here — this file is part
 * of the client bundle.
 */
const client = createAuthClient({
  plugins: [
    twoFactorClient({ twoFactorPage: "/two-factor" }),
    passkeyClient(),
    adminClient({ ac: authAccessControl, roles: authRoles }),
  ],
});

/**
 * The callbackURL passed to Better Auth on sign-up.
 *
 * After native email verification, Better Auth redirects here with success
 * (no extra query) or with ?error=<code> on failure. The /verify-email page
 * reads that query to display a safe status.
 */
const VERIFY_CALLBACK_URL = "/verify-email?status=success";

export async function signUp(input: {
  name: string;
  email: string;
  password: string;
}) {
  return client.signUp.email({
    name: input.name,
    email: input.email,
    password: input.password,
    callbackURL: VERIFY_CALLBACK_URL,
  });
}

export async function signIn(input: {
  email: string;
  password: string;
  rememberMe?: boolean;
  /** First-party return URL validated server-side against trusted origins. */
  callbackURL?: string;
}) {
  return client.signIn.email({
    email: input.email,
    password: input.password,
    rememberMe: input.rememberMe ?? true,
    ...(input.callbackURL ? { callbackURL: input.callbackURL } : {}),
  });
}

export async function signOut() {
  return client.signOut();
}

export async function signInWithGoogle(callbackURL = "/account") {
  return client.signIn.social({
    provider: "google",
    callbackURL,
  });
}

export async function requestPasswordReset(email: string) {
  return client.requestPasswordReset({
    email,
    redirectTo: "/reset-password",
  });
}

export async function resetPassword(input: {
  token: string;
  newPassword: string;
}) {
  return client.resetPassword({
    token: input.token,
    newPassword: input.newPassword,
  });
}

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}) {
  return client.changePassword({
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
    revokeOtherSessions: true,
  });
}

export async function requestEmailChange(newEmail: string) {
  return client.changeEmail({
    newEmail,
    callbackURL: "/change-email-result?status=processed",
  });
}

export async function requestAccountDeletion() {
  return client.deleteUser({ callbackURL: "/account-deleted?status=success" });
}

export async function enableTwoFactor(password: string) {
  return client.twoFactor.enable({ password, method: "totp", issuer: "AuthCore" });
}

export async function verifyTwoFactorTotp(code: string, trustDevice = false) {
  return client.twoFactor.verifyTotp({ code, trustDevice });
}

export async function verifyTwoFactorBackupCode(code: string, trustDevice = false) {
  return client.twoFactor.verifyBackupCode({ code, trustDevice });
}

export async function disableTwoFactor(password: string) {
  return client.twoFactor.disable({ password });
}

export async function signInWithPasskey() {
  return client.signIn.passkey();
}

/**
 * Client-side guard for first-party return URLs from the login page. Only
 * relative paths or HTTPS hosts under the configured first-party domain are
 * accepted; the server independently validates against trusted origins.
 */
export function safeCallbackURL(value: string | null, allowedHostSuffix: string): string | null {
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const suffix = allowedHostSuffix.toLowerCase().replace(/^\./, "");
    if (url.protocol === "https:" && (host === suffix || host.endsWith(`.${suffix}`))) {
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}

export async function addPasskey(name?: string) {
  return client.passkey.addPasskey({
    name: name?.trim() || undefined,
  });
}

export async function listPasskeys() {
  return client.passkey.listUserPasskeys();
}

export async function renamePasskey(id: string, name: string) {
  return client.passkey.updatePasskey({ id, name: name.trim() });
}

export async function deletePasskey(id: string) {
  return client.passkey.deletePasskey({ id });
}

export type ActiveSession = {
  key: string;
  current: boolean;
  createdAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
};

// Session tokens stay inside this client module. The UI receives short-lived,
// random keys that are meaningful only for the current page lifecycle.
const sessionTokens = new Map<string, string>();

export async function listActiveSessions() {
  const [listed, current] = await Promise.all([
    client.listSessions(),
    client.getSession(),
  ]);

  if (listed.error) return { data: null, error: listed.error };

  sessionTokens.clear();
  const currentToken = current.data?.session.token;
  const sessions: ActiveSession[] = (listed.data ?? []).map((session) => {
    const key = crypto.randomUUID();
    sessionTokens.set(key, session.token);
    return {
      key,
      current: session.token === currentToken,
      createdAt: new Date(session.createdAt).toISOString(),
      expiresAt: new Date(session.expiresAt).toISOString(),
      ipAddress: session.ipAddress ?? null,
      userAgent: session.userAgent ?? null,
    };
  });

  sessions.sort((a, b) => Number(b.current) - Number(a.current));
  return { data: sessions, error: null };
}

export async function revokeActiveSession(key: string) {
  const token = sessionTokens.get(key);
  if (!token) throw new Error("Unknown session");
  const result = await client.revokeSession({ token });
  if (!result.error) sessionTokens.delete(key);
  return result;
}

export async function revokeOtherActiveSessions() {
  return client.revokeOtherSessions();
}

/** Admin facade (Phase 18 + Phase 25 user CRUD). Impersonation stays excluded. */
export async function banManagedUser(userId: string) {
  return client.admin.banUser({
    userId,
    banReason: "Administrative security action",
  });
}

export async function unbanManagedUser(userId: string) {
  return client.admin.unbanUser({ userId });
}

export async function revokeManagedUserSessions(userId: string) {
  return client.admin.revokeUserSessions({ userId });
}

/** Roles managed by the administration UI (part of the integration contract). */
export type ManagedRole = "user" | "seller" | "admin";

export async function createManagedUser(input: {
  name: string;
  email: string;
  password: string;
  role?: ManagedRole;
  emailVerified?: boolean;
}) {
  return client.admin.createUser({
    email: input.email,
    password: input.password,
    name: input.name,
    role: input.role ?? "user",
    data:
      input.emailVerified !== undefined
        ? { emailVerified: input.emailVerified }
        : undefined,
  });
}

export async function updateManagedUser(
  userId: string,
  data: { name?: string },
) {
  // Email and emailVerified are immutable through the admin update endpoint:
  // Better Auth rejects both ("You are not allowed to update users email").
  return client.admin.updateUser({ userId, data });
}

export async function setManagedUserRole(userId: string, role: ManagedRole) {
  return client.admin.setRole({ userId, role });
}

export async function setManagedUserPassword(userId: string, newPassword: string) {
  return client.admin.setUserPassword({ userId, newPassword });
}

export async function removeManagedUser(userId: string) {
  return client.admin.removeUser({ userId });
}

export async function listManagedUserSessions(userId: string) {
  return client.admin.listUserSessions({ userId });
}

export async function revokeManagedUserSession(sessionToken: string) {
  return client.admin.revokeUserSession({ sessionToken });
}
