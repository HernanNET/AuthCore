import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CapturedVerificationEmail,
  CapturedEmailPurpose,
  AccountDeletionEmailTransport,
  ChangeEmailConfirmationTransport,
  PasswordResetEmailTransport,
  VerificationEmailTransport,
  SecurityAlertEmailTransport,
} from "./transport";

/**
 * File-based captured mailbox for development and test.
 *
 * Chosen over in-memory because Astro dev/test runs in a separate process from
 * Playwright; file storage is reliable across that process boundary.
 *
 * Each recipient gets a JSON file containing an array of captured messages.
 * The directory lives under the OS temp folder and is NOT gitignored (it is
 * transient and under tmpdir, never inside the repo).
 *
 * NEVER available in production — the retrieval endpoint fails closed when
 * AUTH_ENV !== "test", and this transport is only wired in for non-production.
 */
const MAILBOX_DIR = join(tmpdir(), "authcore-mailbox");

function ensureDir(): void {
  if (!existsSync(MAILBOX_DIR)) mkdirSync(MAILBOX_DIR, { recursive: true });
}

function slugify(email: string): string {
  return email.toLowerCase().replace(/[^a-z0-9]/g, "-");
}

function filePathFor(email: string): string {
  return join(MAILBOX_DIR, `${slugify(email)}.json`);
}

function readMessages(file: string): CapturedVerificationEmail[] {
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf8")) as CapturedVerificationEmail[];
  } catch {
    return [];
  }
}

/** Store a captured verification email for a recipient. */
export function storeCapturedEmail(
  to: string,
  verificationUrl: string,
  purpose: CapturedEmailPurpose = "email-verification",
): CapturedVerificationEmail {
  ensureDir();
  const file = filePathFor(to);
  const messages = readMessages(file);
  const entry: CapturedVerificationEmail = {
    id: randomUUID(),
    to,
    verificationUrl,
    purpose,
    createdAt: new Date().toISOString(),
  };
  messages.push(entry);
  writeFileSync(file, JSON.stringify(messages, null, 2));
  return entry;
}

/** Store an informational security alert without any action URL or token. */
export function storeCapturedSecurityAlert(input: {
  to: string;
  eventType: import("../security-events").SecurityEventType;
  occurredAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}): CapturedVerificationEmail {
  ensureDir();
  const file = filePathFor(input.to);
  const messages = readMessages(file);
  const entry: CapturedVerificationEmail = {
    id: randomUUID(),
    to: input.to,
    verificationUrl: "",
    purpose: "security-alert",
    createdAt: input.occurredAt,
    securityEventType: input.eventType,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  };
  messages.push(entry);
  writeFileSync(file, JSON.stringify(messages, null, 2));
  return entry;
}

/** Retrieve all captured verification emails for a recipient (most-recent last). */
export function getCapturedEmails(
  to: string,
): CapturedVerificationEmail[] {
  return readMessages(filePathFor(to));
}

/** Remove all captured emails for a recipient. */
export function clearCapturedEmails(to: string): void {
  const file = filePathFor(to);
  if (existsSync(file)) writeFileSync(file, "[]");
}

/** Remove ALL captured emails (used by test teardown). */
export function clearAllCapturedEmails(): void {
  if (!existsSync(MAILBOX_DIR)) return;
  for (const f of readdirSync(MAILBOX_DIR)) {
    if (f.endsWith(".json")) unlinkSync(join(MAILBOX_DIR, f));
  }
}

/**
 * Development/test transport: captures the verification email to the file
 * mailbox instead of sending it over the network.
 */
export const capturedMailboxTransport: VerificationEmailTransport = {
  async sendVerificationEmail({ to, verificationUrl }) {
    storeCapturedEmail(to, verificationUrl, "email-verification");
  },
};

/** Development/test password-reset transport backed by the same safe mailbox. */
export const capturedPasswordResetTransport: PasswordResetEmailTransport = {
  async sendPasswordResetEmail({ to, passwordResetUrl }) {
    storeCapturedEmail(to, passwordResetUrl, "password-reset");
  },
};

/** Development/test approval message sent to the current email address. */
export const capturedChangeEmailConfirmationTransport: ChangeEmailConfirmationTransport = {
  async sendChangeEmailConfirmation({ to, confirmationUrl }) {
    storeCapturedEmail(to, confirmationUrl, "email-change-confirmation");
  },
};

/** Development/test account-deletion transport backed by the captured mailbox. */
export const capturedAccountDeletionTransport: AccountDeletionEmailTransport = {
  async sendAccountDeletionEmail({ to, deletionUrl }) {
    storeCapturedEmail(to, deletionUrl, "account-deletion");
  },
};

/** Development/test security-alert transport. Contains no actionable secret. */
export const capturedSecurityAlertTransport: SecurityAlertEmailTransport = {
  async sendSecurityAlert(input) {
    storeCapturedSecurityAlert(input);
  },
};
