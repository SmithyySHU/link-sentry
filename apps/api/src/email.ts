import nodemailer from "nodemailer";

type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

const EMAIL_ENABLED = process.env.EMAIL_ENABLED === "true";
const EMAIL_FROM = process.env.EMAIL_FROM || "Link-Sentry <no-reply@local>";
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";

function getTransport() {
  if (!EMAIL_ENABLED) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  if (!EMAIL_ENABLED) {
    console.log(
      `[email] disabled; would send to=${payload.to} subject="${payload.subject}"`,
    );
    return;
  }

  const transport = getTransport();
  if (!transport) return;

  await transport.sendMail({
    from: EMAIL_FROM,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
  });
}
