/*
 * Builds and sends the alert email. Sending needs three GitHub secrets:
 * GMAIL_USER, GMAIL_APP_PASSWORD (a Gmail app password) and NOTIFY_TO.
 */
import { summarize } from './merge.js';

export const NOTIFY_TYPES = { newListing: 'new', priceDrop: 'price_drop', priceIncrease: 'price_up', removed: 'removed' };
const LABELS = { new: 'New listing', price_drop: 'Price drop', price_up: 'Price increase', removed: 'Sold or removed' };
const PLATFORMS = { carousell: 'Carousell', fb_marketplace: 'FB Marketplace', fb_group: 'FB Group' };

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 });
const money = (n) => (typeof n === 'number' ? peso.format(n) : 'no price');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function emailConfig(env = process.env) {
  const cfg = { user: env.GMAIL_USER?.trim(), pass: env.GMAIL_APP_PASSWORD?.replace(/\s+/g, ''), to: env.NOTIFY_TO?.trim() };
  return { ...cfg, configured: Boolean(cfg.user && cfg.pass && cfg.to) };
}

export function wantedEvents(events, notifyOn = {}) {
  const wanted = new Set(Object.entries(NOTIFY_TYPES).filter(([key]) => notifyOn[key]).map(([, type]) => type));
  return events.filter((e) => wanted.has(e.type));
}

function priceText(e) {
  if (e.type === 'price_drop' || e.type === 'price_up') return `${money(e.from)} → ${money(e.to)}`;
  if (e.type === 'removed') return `last at ${money(e.from)}`;
  return money(e.to);
}

/** Returns { subject, text, html } or null when nothing is worth sending. */
export function buildEmail(events, { notifyOn, dashboardUrl, watchlist }) {
  const list = wantedEvents(events, notifyOn);
  if (!list.length) return null;
  const labelFor = (id) => watchlist?.items?.find((i) => i.id === id)?.label || '';
  const subject = `Bag Tracker: ${summarize(list)}`;

  const text = [
    subject,
    '',
    ...list.map((e) => `${LABELS[e.type]} · ${labelFor(e.itemId)} · ${PLATFORMS[e.platform] || e.platform}\n${e.title}\n${priceText(e)}\n${e.url}\n`),
    dashboardUrl ? `Dashboard: ${dashboardUrl}` : '',
  ].join('\n');

  const rows = list
    .map(
      (e) => `<tr><td style="padding:12px 0;border-bottom:1px solid #e0e3e8">
        <div style="font-size:12px;color:#646b78">${esc(LABELS[e.type])} · ${esc(labelFor(e.itemId))} · ${esc(PLATFORMS[e.platform] || e.platform)}</div>
        <div style="font-size:15px;font-weight:600;margin:2px 0"><a href="${esc(e.url)}" style="color:#121418">${esc(e.title)}</a></div>
        <div style="font-size:14px;color:#121418">${esc(priceText(e))}</div>
      </td></tr>`,
    )
    .join('');
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;color:#121418">
    <h1 style="font-size:18px;margin:0 0 4px">${esc(summarize(list))}</h1>
    <p style="margin:0 0 12px;color:#646b78;font-size:13px">From your Bag Tracker scan</p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    ${dashboardUrl ? `<p style="margin-top:16px"><a href="${esc(dashboardUrl)}" style="color:#121418;font-weight:600">Open the dashboard</a></p>` : ''}
  </div>`;
  return { subject, text, html };
}

export async function sendEmail(email, cfg, { createTransport } = {}) {
  if (!cfg.configured) return { sent: false, reason: 'Email secrets are not set' };
  const make = createTransport || (await import('nodemailer')).default.createTransport;
  const transport = make({ service: 'gmail', auth: { user: cfg.user, pass: cfg.pass } });
  await transport.sendMail({ from: `Bag Tracker <${cfg.user}>`, to: cfg.to, subject: email.subject, text: email.text, html: email.html });
  return { sent: true };
}
