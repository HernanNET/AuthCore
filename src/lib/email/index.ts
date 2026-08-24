import { env } from "../env";
import type {
  AccountDeletionEmailTransport,
  ChangeEmailConfirmationTransport,
  PasswordResetEmailTransport,
  VerificationEmailTransport,
  SecurityAlertEmailTransport,
} from "./transport";
import {
  capturedAccountDeletionTransport,
  capturedChangeEmailConfirmationTransport,
  capturedMailboxTransport,
  capturedPasswordResetTransport,
  capturedSecurityAlertTransport,
} from "./captured-mailbox";

/**
 * Selects the verification email transport based on environment.
 *
 * - Test / development: file-based captured mailbox (no real email sent).
 * - Production: a real provider transport must be supplied. Until one is
 *   configured, we fail safely by throwing instead of pretending delivery.
 *
 * No production vendor (Resend, SendGrid, etc.) is added in Phase 2.
 */
function resolveTransport(): VerificationEmailTransport {
  if (env.isTestMode || env.AUTH_ENV === "development") {
    return capturedMailboxTransport;
  }
  return {
    async sendVerificationEmail() {
      throw new Error(
        "No production email transport is configured. " +
          "Set up a real provider before deploying to production.",
      );
    },
  };
}

export const verificationEmailTransport: VerificationEmailTransport =
  resolveTransport();

function resolvePasswordResetTransport(): PasswordResetEmailTransport {
  if (env.isTestMode || env.AUTH_ENV === "development") {
    return capturedPasswordResetTransport;
  }
  return {
    async sendPasswordResetEmail() {
      throw new Error(
        "No production password-reset email transport is configured. " +
          "Set up a real provider before deploying to production.",
      );
    },
  };
}

export const passwordResetEmailTransport: PasswordResetEmailTransport =
  resolvePasswordResetTransport();

function resolveChangeEmailConfirmationTransport(): ChangeEmailConfirmationTransport {
  if (env.isTestMode || env.AUTH_ENV === "development") {
    return capturedChangeEmailConfirmationTransport;
  }
  return {
    async sendChangeEmailConfirmation() {
      throw new Error(
        "No production change-email transport is configured. " +
          "Set up a real provider before deploying to production.",
      );
    },
  };
}

export const changeEmailConfirmationTransport: ChangeEmailConfirmationTransport =
  resolveChangeEmailConfirmationTransport();

function resolveAccountDeletionTransport(): AccountDeletionEmailTransport {
  if (env.isTestMode || env.AUTH_ENV === "development") {
    return capturedAccountDeletionTransport;
  }
  return {
    async sendAccountDeletionEmail() {
      throw new Error(
        "No production account-deletion email transport is configured. " +
          "Set up a real provider before deploying to production.",
      );
    },
  };
}

export const accountDeletionEmailTransport: AccountDeletionEmailTransport =
  resolveAccountDeletionTransport();

function resolveSecurityAlertTransport(): SecurityAlertEmailTransport {
  if (env.isTestMode || env.AUTH_ENV === "development") {
    return capturedSecurityAlertTransport;
  }
  return {
    async sendSecurityAlert() {
      throw new Error(
        "No production security-alert email transport is configured. " +
          "Set up a real provider before deploying to production.",
      );
    },
  };
}

export const securityAlertEmailTransport: SecurityAlertEmailTransport =
  resolveSecurityAlertTransport();

export type {
  VerificationEmailTransport,
  PasswordResetEmailTransport,
  ChangeEmailConfirmationTransport,
  AccountDeletionEmailTransport,
  SecurityAlertEmailTransport,
  CapturedVerificationEmail,
  CapturedEmailPurpose,
} from "./transport";
export {
  storeCapturedEmail,
  storeCapturedSecurityAlert,
  getCapturedEmails,
  clearCapturedEmails,
  clearAllCapturedEmails,
} from "./captured-mailbox";
