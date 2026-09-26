import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEmail, emailConfig, sendEmail, wantedEvents } from '../lib/notify.js';

const watchlist = { items: [{ id: 'balenciaga-city', label: 'Balenciaga City' }] };
const events = [
  { type: 'new', itemId: 'balenciaga-city', platform: 'carousell', title: 'Balenciaga City <b>black</b>', url: 'https://www.carousell.ph/p/x-1/', to: 38000 },
  { type: 'price_drop', itemId: 'balenciaga-city', platform: 'carousell', title: 'Bal City', url: 'https://www.carousell.ph/p/x-2/', from: 40000, to: 35000 },
  { type: 'price_up', itemId: 'balenciaga-city', platform: 'carousell', title: 'City', url: 'https://www.carousell.ph/p/x-3/', from: 1, to: 2 },
];
const notifyOn = { newListing: true, priceDrop: true, priceIncrease: false, removed: false };

test('only switched-on change types are emailed', () => {
  assert.deepEqual(wantedEvents(events, notifyOn).map((e) => e.type), ['new', 'price_drop']);
  assert.equal(buildEmail(events.slice(2), { notifyOn }), null);
});

test('email has a summary subject, escaped HTML and links', () => {
  const email = buildEmail(events, { notifyOn, dashboardUrl: 'https://jeck-bot.github.io/Listing-tracker/', watchlist });
  assert.equal(email.subject, 'Bag Tracker: 1 new, 1 price drop');
  assert.match(email.html, /Balenciaga City &lt;b&gt;black&lt;\/b&gt;/);
  assert.doesNotMatch(email.html, /<b>black/);
  assert.match(email.html, /₱40,000 → ₱35,000/);
  assert.match(email.text, /https:\/\/www\.carousell\.ph\/p\/x-1\//);
  assert.match(email.text, /Dashboard: https:\/\/jeck-bot\.github\.io/);
});

test('emailConfig needs all three secrets and strips app password spaces', () => {
  assert.equal(emailConfig({}).configured, false);
  assert.equal(emailConfig({ GMAIL_USER: 'a@gmail.com', GMAIL_APP_PASSWORD: 'x' }).configured, false);
  const cfg = emailConfig({ GMAIL_USER: 'a@gmail.com', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop', NOTIFY_TO: 'b@gmail.com' });
  assert.equal(cfg.configured, true);
  assert.equal(cfg.pass, 'abcdefghijklmnop');
});

test('sendEmail skips without secrets and uses Gmail when configured', async () => {
  assert.deepEqual(await sendEmail({}, { configured: false }), { sent: false, reason: 'Email secrets are not set' });
  const sent = [];
  const createTransport = (opts) => ({ sendMail: async (msg) => sent.push({ opts, msg }) });
  const email = buildEmail(events, { notifyOn, watchlist });
  const res = await sendEmail(email, emailConfig({ GMAIL_USER: 'a@gmail.com', GMAIL_APP_PASSWORD: 'p', NOTIFY_TO: 'b@gmail.com' }), { createTransport });
  assert.deepEqual(res, { sent: true });
  assert.equal(sent[0].opts.service, 'gmail');
  assert.equal(sent[0].msg.to, 'b@gmail.com');
  assert.equal(sent[0].msg.subject, 'Bag Tracker: 1 new, 1 price drop');
});
