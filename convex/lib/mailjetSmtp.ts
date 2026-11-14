"use node";

import { assertMailjetReady, mailjetCreds, type MailjetRecipient } from "./mailjet";

// WP19c besluit 5, A-invariant 13–15 en 17: een mail met inline-foto via de
// SMTP-ingang van Mailjet. De Send API v3.1 zet een inline-bijlage naast de
// `multipart/alternative` in een `multipart/mixed`; Apple Mail toont de foto
// dan twee keer. Hier bouwt nodemailer de MIME zelf:
//   multipart/alternative [ text/plain, multipart/related [ text/html, image ] ]
//
// - Host `in-v3.mailjet.com`, poort 587, STARTTLS verplicht (`requireTLS`),
//   anders gaan key en secret onversleuteld over de lijn.
// - Login met dezelfde `MAILJET_API_KEY`/`MAILJET_API_SECRET` als de Send API.
// - Time-outs binnen 30 s, zodat de terugval (Send API zonder foto) binnen de
//   action valt.
// - Besluit 6: `X-Mailjet-TrackOpen: 0` en `X-Mailjet-TrackClick: 0`. Geen
//   `X-MJ-CustomID` of `X-MJ-EventPayload`: de bounce koppelt op het adres.
// - Sender-check en credentials vóór de verbinding (`assertMailjetReady`).
//
// nodemailer laadt lazy: alleen deze weg heeft hem nodig (`externalPackages`).

export const MAILJET_SMTP_HOST = "in-v3.mailjet.com";
export const MAILJET_SMTP_PORT = 587;
const CONNECTION_TIMEOUT_MS = 15_000;
const GREETING_TIMEOUT_MS = 15_000;
const SOCKET_TIMEOUT_MS = 30_000;

export type MailjetInlineImage = {
  contentId: string;
  filename: string;
  contentType: string;
  content: Uint8Array;
};

export type MailjetSmtpMessage = {
  from: MailjetRecipient;
  to: MailjetRecipient[];
  subject: string;
  htmlPart: string;
  textPart: string;
  inlineImages: MailjetInlineImage[];
};

type Transport = { sendMail: (mail: Record<string, unknown>) => Promise<unknown>; close?: () => void };
type Nodemailer = { createTransport: (opts: Record<string, unknown>) => Transport };

async function loadNodemailer(): Promise<Nodemailer> {
  const mod = (await import("nodemailer")) as unknown as { default?: Nodemailer } & Nodemailer;
  return mod.default ?? mod;
}

const address = (r: MailjetRecipient) => (r.name ? { name: r.name, address: r.email } : r.email);

/** Verstuurt via SMTP. Gooit bij elke fout (poort dicht, login, time-out, weigering). */
export async function sendMailjetSmtp(msg: MailjetSmtpMessage): Promise<void> {
  assertMailjetReady(msg.from.email);
  const { key, secret } = mailjetCreds();
  const nodemailer = await loadNodemailer();
  const transport = nodemailer.createTransport({
    host: MAILJET_SMTP_HOST,
    port: MAILJET_SMTP_PORT,
    secure: false,
    requireTLS: true,
    auth: { user: key, pass: secret },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
  try {
    await transport.sendMail({
      from: address(msg.from),
      to: msg.to.map(address),
      subject: msg.subject,
      text: msg.textPart,
      html: msg.htmlPart,
      attachments: msg.inlineImages.map((img) => ({
        filename: img.filename,
        content: Buffer.from(img.content),
        contentType: img.contentType,
        cid: img.contentId,
        contentDisposition: "inline",
      })),
      headers: { "X-Mailjet-TrackOpen": "0", "X-Mailjet-TrackClick": "0" },
    });
  } finally {
    transport.close?.();
  }
}
