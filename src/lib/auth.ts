import { betterAuth } from "better-auth";
import { admin, twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { env } from "./env";
import { pool } from "./database";
import { recordSecurityEvent } from "./security-events";
import { authAccessControl, authRoles } from "./access-control";
import {
  accountDeletionEmailTransport,
  changeEmailConfirmationTransport,
  passwordResetEmailTransport,
  verificationEmailTransport,
} from "./email";

/**
 * Better Auth server instance.
 *
 * The auth module owns this PostgreSQL connection and the tables it manages:
 *   user, account, session, verification (+ any internal tables Better Auth
 *   requires). No second user database is used.
 *
 * Phase 20 scope: registration + email verification + email/password login +
 *   Google OAuth + forgot/reset password.
 *   - Google provider uses native Better Auth OAuth (no manual code exchange).
 *   - Google credentials are server-only (GOOGLE_CLIENT_SECRET never in client).
 *   - Empty client ID/secret = Google provider not configured (disabled).
 *   - Account linking uses Better Auth safe defaults — no forced linking,
 *     no allowDifferentEmails, no trustedProviders hacks.
 *   - autoSignInAfterVerification stays false so verification alone never
 *     creates a session.
 *
 * Password reset uses Better Auth's one-time verification records. Authenticated
 * users can also list/revoke sessions and securely change their verified email
 * through Better Auth's native APIs. Verified deletion removes the complete
 * local identity graph only after a matching-session email confirmation. TOTP
 * 2FA and encrypted one-time recovery codes protect credential sign-in. Passkeys
 * add phishing-resistant WebAuthn registration and passwordless sign-in.
 * Database-backed, per-IP throttling protects high-risk public endpoints. A
 * server-only security event log records successful sensitive operations and
 * drives token-free email alerts for new sign-in contexts and critical changes.
 */
export { pool } from "./database";

const socialProviders: Record<string, unknown> = {};

type RateLimitRule = { window: number; max: number };

function protectedRateLimit(rule: RateLimitRule) {
  return async (request: Request): Promise<RateLimitRule> => {
    // The acceptance suite shares one loopback address. A test can explicitly
    // opt into the production-strength rule with a test-only marker header.
    // This branch is impossible when AUTH_ENV is not "test".
    if (env.isTestMode) {
      return request.headers.get("x-authcore-test-rate-limit") === "strict"
        ? { ...rule, window: 2 }
        : { window: 1, max: 10_000 };
    }
    return rule;
  };
}

if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  };
}

export const auth = betterAuth({
  appName: "AuthCore",
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.BETTER_AUTH_ORIGIN],
  secret: env.BETTER_AUTH_SECRET,
  database: pool,
  user: {
    changeEmail: {
      enabled: true,
      updateEmailWithoutVerification: false,
      sendChangeEmailConfirmation: async ({ user, newEmail, url }, _request) => {
        await changeEmailConfirmationTransport.sendChangeEmailConfirmation({
          to: user.email,
          newEmail,
          confirmationUrl: url,
        });
      },
    },
    deleteUser: {
      enabled: true,
      deleteTokenExpiresIn: env.ACCOUNT_DELETION_EXPIRES_IN_SECONDS,
      sendDeleteAccountVerification: async ({ user, token }, _request) => {
        // Use a server-rendered confirmation route so the token never enters
        // client JavaScript or the rendered DOM.
        const deletionUrl = `${env.BETTER_AUTH_URL}/confirm-account-deletion?token=${encodeURIComponent(token)}`;
        await accountDeletionEmailTransport.sendAccountDeletionEmail({
          to: user.email,
          deletionUrl,
        });
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: env.PASSWORD_RESET_EXPIRES_IN_SECONDS,
    revokeSessionsOnPasswordReset: true,
    // Duplicate-email sign-up responses must preserve the complete synthetic
    // user shape after enabling plugins. Values are server-owned and cannot be
    // supplied by registration input.
    customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
      ...coreFields,
      twoFactorEnabled: false,
      role: "user",
      banned: false,
      banReason: null,
      banExpires: null,
      ...additionalFields,
      id,
    }),
    sendResetPassword: async ({ user, url }, _request) => {
      await passwordResetEmailTransport.sendPasswordResetEmail({
        to: user.email,
        passwordResetUrl: url,
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }, _request) => {
      await verificationEmailTransport.sendVerificationEmail({
        to: user.email,
        verificationUrl: url,
      });
    },
    sendOnSignUp: true,
    sendOnSignIn: true,
    expiresIn: env.EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
    autoSignInAfterVerification: false,
  },
  socialProviders: socialProviders as { google?: { clientId: string; clientSecret: string } },
  rateLimit: {
    enabled: true,
    storage: "database",
    modelName: "rateLimit",
    window: 60,
    max: env.isTestMode ? 10_000 : 300,
    customRules: {
      "/sign-in/email": protectedRateLimit({ window: 60, max: 5 }),
      "/sign-up/email": protectedRateLimit({ window: 3_600, max: 5 }),
      "/request-password-reset": protectedRateLimit({ window: 300, max: 3 }),
      "/two-factor/*": protectedRateLimit({ window: 60, max: 5 }),
      "/passkey/*": protectedRateLimit({ window: 60, max: 20 }),
    },
  },
  advanced: {
    useSecureCookies: env.isSecureOrigin,
    disableCSRFCheck: false,
    disableOriginCheck: false,
    ipAddress: {
      ipAddressHeaders: ["x-authcore-client-ip"],
      ipv6Subnet: 64,
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await recordSecurityEvent({ userId: user.id, type: "account_created" });
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          await recordSecurityEvent({
            userId: session.userId,
            type: "signed_in",
            ipAddress: session.ipAddress,
            userAgent: session.userAgent,
          });
        },
      },
    },
  },
  plugins: [
    twoFactor({
      issuer: "AuthCore",
    }),
    passkey({
      rpID: new URL(env.BETTER_AUTH_URL).hostname,
      rpName: "AuthCore",
      origin: new URL(env.BETTER_AUTH_URL).origin,
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
    }),
    admin({
      ac: authAccessControl,
      roles: authRoles,
      defaultRole: "user",
      adminRoles: ["admin"],
      bannedUserMessage: "This account is not permitted to sign in.",
    }),
  ],
});

export type Auth = typeof auth;
