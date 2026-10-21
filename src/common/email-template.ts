import { config } from '../config.js';

/** A ready-to-send email: the HTML part and its plain-text twin (both matter for inbox placement). */
export interface EmailBody {
  html: string;
  text: string;
}

interface Template {
  /** Inbox preview line shown after the subject. */
  preview: string;
  heading: string;
  /** Paragraphs of plain text; escaped here. */
  paragraphs: string[];
  /** A large, centred value such as a one-time code. */
  highlight?: string;
  cta?: { label: string; url: string };
  /** Small print under the card, e.g. "didn't ask for this?". */
  footnote?: string;
}

// Brand tokens (docs/BRAND.md). Email clients don't read CSS variables, so the hex values live here.
const C = { neem: '#1F3A30', marigold: '#F2A33A', marigoldSoft: '#FCEBCD', chalk: '#F7F5EF', sand: '#EEEADF', ink2: '#3D5248', muted: '#6B7A72', line: '#E3DDCD' };
const SANS = "Onest, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const DISPLAY = "Caregold, Georgia, 'Times New Roman', serif";

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** Turns plain text into email-safe HTML: escaped, with line breaks kept. */
const para = (s: string) => escapeHtml(s).replace(/\n/g, '<br>');

/**
 * The one FindFlatmates email layout: Chalk page, white card, Marigold arch accent, Neem text.
 * Tables and inline styles only, so it holds up in Gmail, Outlook and Apple Mail.
 */
export function renderEmail(t: Template): EmailBody {
  const web = config.WEB_URL;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(t.heading)}</title>
<style>
  @font-face { font-family: 'Onest'; src: url('${web}/fonts/onest.woff2') format('woff2'); font-weight: 400 700; }
  @font-face { font-family: 'Caregold'; src: url('${web}/fonts/caregold.woff2') format('woff2'); }
  @media (max-width: 520px) { .card { padding: 28px 22px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background:${C.chalk};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(t.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.chalk};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
      <tr><td style="padding:0 4px 20px;">
        <a href="${web}" style="text-decoration:none;font-family:${DISPLAY};font-size:22px;color:${C.neem};">
          <img src="${web}/email-logo.png" width="28" height="28" alt="" style="vertical-align:-6px;border:0;margin-right:6px;">findflatmates<span style="color:${C.marigold};">.in</span>
        </a>
      </td></tr>
      <tr><td class="card" style="background:#ffffff;border-radius:20px;border-top:6px solid ${C.marigold};padding:36px 36px 32px;font-family:${SANS};color:${C.ink2};font-size:15px;line-height:1.6;">
        <h1 style="margin:0 0 16px;font-family:${DISPLAY};font-weight:400;font-size:28px;line-height:1.2;color:${C.neem};">${escapeHtml(t.heading)}</h1>
        ${t.paragraphs.map((p) => `<p style="margin:0 0 14px;">${para(p)}</p>`).join('\n        ')}
        ${t.highlight ? `<div style="margin:22px 0;padding:18px;background:${C.marigoldSoft};border-radius:14px;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:${C.neem};">${escapeHtml(t.highlight)}</div>` : ''}
        ${t.cta ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;"><tr><td style="background:${C.marigold};border-radius:999px;"><a href="${escapeHtml(t.cta.url)}" style="display:inline-block;padding:13px 26px;font-family:${SANS};font-size:15px;font-weight:600;color:${C.neem};text-decoration:none;">${escapeHtml(t.cta.label)} &rarr;</a></td></tr></table>` : ''}
      </td></tr>
      ${t.footnote ? `<tr><td style="padding:18px 8px 0;font-family:${SANS};font-size:13px;line-height:1.5;color:${C.muted};">${para(t.footnote)}</td></tr>` : ''}
      <tr><td style="padding:24px 8px 0;border-top:0;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.muted};">
        FindFlatmates · Rooms, flats and flatmates across India<br>
        <a href="${web}/contact" style="color:${C.muted};">Contact</a> &nbsp;·&nbsp; <a href="${web}/privacy" style="color:${C.muted};">Privacy</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    t.heading,
    '',
    ...t.paragraphs.flatMap((p) => [p, '']),
    ...(t.highlight ? [t.highlight, ''] : []),
    ...(t.cta ? [`${t.cta.label}: ${t.cta.url}`, ''] : []),
    ...(t.footnote ? [t.footnote, ''] : []),
    '—',
    `FindFlatmates · ${web}`,
  ].join('\n');

  return { html, text };
}
