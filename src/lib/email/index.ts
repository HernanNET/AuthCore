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
import { createResendTransports } from "./resend-transport";

/**
 * Selects the email transports based on environment.
 *
 * - Test / development: file-based captured mailbox (no real email sent).
 * - Production with RESEND_API_KEY + AUTHCORE_EMAIL_FROM: Resend HTTP API.
 * - Production without them: sending throws instead of pretending delivery,
 *   so a misconfigured deployment is visible as soon as an email is needed.
 */
const useCapturedMailbox = env.isTestMode || env.AUTH_ENV === "development";

const productionTransports =
  !useCapturedMailbox && env.RESEND_API_KEY && env.AUTHCORE_EMAIL_FROM
    ? createResendTransports({
        apiKey: env.RESEND_API_KEY,
        fromAddress: env.AUTHCORE_EMAIL_FROM,
      })
    : null;

function missingTransportError(): never {
  throw new Error(
    "No production email transport is configured. " +
      "Set RESEND_API_KEY and AUTHCORE_EMAIL_FROM before deploying to production.",
  );
}

export const verificationEmailTransport: VerificationEmailTransport =
  useCapturedMailbox
    ? capturedMailboxTransport
    : productionTransports?.verificationEmailTransport ?? {
        async sendVerificationEmail() {
          missingTransportError();
        },
      };

export const passwordResetEmailTransport: PasswordResetEmailTransport =
  useCapturedMailbox
    ? capturedPasswordResetTransport
    : productionTransports?.passwordResetEmailTransport ?? {
        async sendPasswordResetEmail() {
          missingTransportError();
        },
      };

export const changeEmailConfirmationTransport: ChangeEmailConfirmationTransport =
  useCapturedMailbox
    ? capturedChangeEmailConfirmationTransport
    : productionTransports?.changeEmailConfirmationTransport ?? {
        async sendChangeEmailConfirmation() {
          missingTransportError();
        },
      };

export const accountDeletionEmailTransport: AccountDeletionEmailTransport =
  useCapturedMailbox
    ? capturedAccountDeletionTransport
    : productionTransports?.accountDeletionEmailTransport ?? {
        async sendAccountDeletionEmail() {
          missingTransportError();
        },
      };

export const securityAlertEmailTransport: SecurityAlertEmailTransport =
  useCapturedMailbox
    ? capturedSecurityAlertTransport
    : productionTransports?.securityAlertEmailTransport ?? {
        async sendSecurityAlert() {
          missingTransportError();
        },
      };

export { getCapturedEmails, clearAllCapturedEmails } from "./captured-mailbox";
