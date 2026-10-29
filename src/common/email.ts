import { Logger } from '@nestjs/common';
import { config } from '../config.js';
import type { EmailBody } from './email-template.js';

const log = new Logger('Email');

/**
 * Sends one email (HTML with a plain-text twin) through Resend. Resolves false when it couldn't be sent.
 * Without RESEND_API_KEY, local development logs the email instead (and reports it sent).
 */
export async function sendEmail(to: string, subject: string, { html, text }: EmailBody, replyTo?: string): Promise<boolean> {
  if (!config.RESEND_API_KEY) {
    if (process.env.NODE_ENV === 'production') {
      log.error(`Not sent ("${subject}"): RESEND_API_KEY is not set`);
      return false;
    }
    log.warn(`[dev] Email to ${to}: ${subject}\n${text}\n(set RESEND_API_KEY to send real emails)`);
    return true;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.EMAIL_FROM, to: [to], subject, html, text, reply_to: replyTo }),
    signal: AbortSignal.timeout(8000),
  }).catch((e: Error) => {
    log.error(`Not sent ("${subject}"): ${e.message}`);
    return undefined;
  });
  // Callers retry on false; without this line a bad key or unverified domain fails silently forever.
  if (res && !res.ok) log.error(`Not sent ("${subject}"): Resend ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return !!res?.ok;
}
