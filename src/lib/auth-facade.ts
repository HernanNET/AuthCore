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
}) {
  return client.signIn.email({
    email: input.email,
    password: input.password,
    rememberMe: input.rememberMe ?? true,
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

/** Phase 18 admin facade: intentionally excludes role changes and impersonation. */
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
