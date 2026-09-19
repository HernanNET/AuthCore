/**
 * Production email transport over the Resend HTTP API.
 *
 * SMTP delivery is not available on several managed hosting platforms (free
 * plans commonly block ports 25/465/587), so AuthCore sends email through
 * Resend's HTTPS API instead. Requires RESEND_API_KEY and a verified sender
 * address (AUTHCORE_EMAIL_FROM); without them the transport fails closed.
 */
const RESEND_API_URL = "https://api.resend.com/emails";

export interface ResendTransportConfig {
  apiKey: string;
  fromAddress: string;
  fetchImpl?: typeof fetch;
}

interface ResendSendInput {
  to: string;
  subject: string;
  text: string;
}

async function sendViaResend(config: ResendTransportConfig, input: ResendSendInput): Promise<void> {
  const response = await (config.fetchImpl ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.fromAddress,
      to: [input.to],
      subject: input.subject,
      text: input.text,
    }),
  });
  if (!response.ok) {
    throw new Error(`Resend email delivery failed with status ${response.status}`);
  }
}

export function createResendTransports(config: ResendTransportConfig) {
  const send = (subject: string, body: string) => async (to: string) =>
    sendViaResend(config, { to, subject, text: body });

  return {
    verificationEmailTransport: {
      async sendVerificationEmail(input: { to: string; verificationUrl: string }) {
        await sendViaResend(config, {
          to: input.to,
          subject: "Verifica tu correo electrónico",
          text: `Confirma tu dirección en este enlace: ${input.verificationUrl}\n\nSi no creaste esta cuenta, ignora este mensaje.`,
        });
      },
    },
    passwordResetEmailTransport: {
      async sendPasswordResetEmail(input: { to: string; passwordResetUrl: string }) {
        await sendViaResend(config, {
          to: input.to,
          subject: "Restablece tu contraseña",
          text: `Restablece tu contraseña en este enlace (caduca en una hora): ${input.passwordResetUrl}\n\nSi no lo solicitaste, ignora este mensaje.`,
        });
      },
    },
    changeEmailConfirmationTransport: {
      async sendChangeEmailConfirmation(input: { to: string; newEmail: string; confirmationUrl: string }) {
        await sendViaResend(config, {
          to: input.to,
          subject: "Confirma tu nuevo correo electrónico",
          text: `Confirma el cambio a ${input.newEmail} en este enlace: ${input.confirmationUrl}\n\nSi no iniciaste este cambio, tu dirección sigue siendo la actual.`,
        });
      },
    },
    accountDeletionEmailTransport: {
      async sendAccountDeletionEmail(input: { to: string; deletionUrl: string }) {
        await sendViaResend(config, {
          to: input.to,
          subject: "Confirma la eliminación de tu cuenta",
          text: `Confirma la eliminación definitiva de tu cuenta en este enlace: ${input.deletionUrl}`,
        });
      },
    },
    securityAlertEmailTransport: {
      async sendSecurityAlert(input: {
        to: string;
        eventType: string;
        occurredAt: string;
        ipAddress: string | null;
        userAgent: string | null;
      }) {
        await sendViaResend(config, {
          to: input.to,
          subject: "Alerta de seguridad en tu cuenta",
          text: `Detectamos el evento "${input.eventType}" el ${input.occurredAt}.` +
            `${input.ipAddress ? `\nDirección IP: ${input.ipAddress}` : ""}` +
            `${input.userAgent ? `\nNavegador: ${input.userAgent}` : ""}`,
        });
      },
    },
  };
}
