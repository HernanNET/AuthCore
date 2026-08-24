/**
 * Provider-independent abstraction for sending verification emails.
 *
 * Better Auth depends on this abstraction rather than on any specific vendor
 * (Resend, SMTP, etc.). Phase 2 ships only a development/test captured mailbox.
 * A production transport must be supplied before production deployment.
 */
export interface VerificationEmailTransport {
  sendVerificationEmail(input: {
    to: string;
    verificationUrl: string;
  }): Promise<void>;
}

/** Transport used by Better Auth's native password-reset flow. */
export interface PasswordResetEmailTransport {
  sendPasswordResetEmail(input: {
    to: string;
    passwordResetUrl: string;
  }): Promise<void>;
}

/** Approval message sent to the account's current verified address. */
export interface ChangeEmailConfirmationTransport {
  sendChangeEmailConfirmation(input: {
    to: string;
    newEmail: string;
    confirmationUrl: string;
  }): Promise<void>;
}

/** Final account-deletion verification sent to the signed-in user's email. */
export interface AccountDeletionEmailTransport {
  sendAccountDeletionEmail(input: {
    to: string;
    deletionUrl: string;
  }): Promise<void>;
}

/** Informational security alert. It never contains an authentication token. */
export interface SecurityAlertEmailTransport {
  sendSecurityAlert(input: {
    to: string;
    eventType: SecurityEventType;
    occurredAt: string;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<void>;
}

export type CapturedEmailPurpose =
  | "email-verification"
  | "password-reset"
  | "email-change-confirmation"
  | "account-deletion"
  | "security-alert";

/**
 * A captured message stored by the development/test transport.
 * The verification URL is intentionally stored so Playwright can retrieve it.
 * This data must remain test/development only — never expose in production.
 */
export interface CapturedVerificationEmail {
  id: string;
  to: string;
  verificationUrl: string;
  purpose: CapturedEmailPurpose;
  createdAt: string;
  securityEventType?: SecurityEventType;
  ipAddress?: string | null;
  userAgent?: string | null;
}
import type { SecurityEventType } from "../security-events";
