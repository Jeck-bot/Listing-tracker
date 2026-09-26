import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { processInbox } from '../run.js';

const repo = new URL('../../', import.meta.url);

async function setup(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'bag-tracker-'));
  await cp(new URL('config/', repo), path.join(root, 'config'), { recursive: true });
  await mkdir(path.join(root, 'data'));
  await mkdir(path.join(root, 'scanner/inbox'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await writeFile(path.join(root, 'scanner/inbox', name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return root;
}

const cowork = (listings, extra = {}) => ({ source: 'cowork', runAt: '2026-09-26T02:00:00Z', platform: 'carousell', status: 'ok', complete: true, listings, ...extra });
const now = new Date('2026-09-26T02:01:00Z');
const secrets = { GMAIL_USER: 'a@gmail.com', GMAIL_APP_PASSWORD: 'p', NOTIFY_TO: 'b@gmail.com' };

test('processes a Cowork file end to end: match, save, clear inbox, email', async () => {
  const root = await setup({
    'cowork-1.json': cowork([
      { url: 'https://www.carousell.ph/p/balenciaga-city-bag-100001/', title: 'Balenciaga Classic City Black', price: 38000, searchTerm: 'balenciaga city' },
      { url: 'https://www.carousell.ph/p/chloe-lock-100002/', title: 'Chloe Paddington lock and key', price: 4500, searchTerm: 'chloe padlock' },
      { url: 'https://www.carousell.ph/p/balenciaga-tote-100003/', title: 'Balenciaga Everyday Tote Quezon City', price: 20000 },
      { url: 'https://www.carousell.ph/p/wtb-100004/', title: 'WTB Chloe Paddington', price: 1 },
    ]),
  });
  const sent = [];
  const out = await processInbox({ root, now, env: secrets, transport: () => ({ sendMail: async (m) => sent.push(m) }) });

  assert.equal(out.summary, '2 new');
  const data = JSON.parse(await readFile(path.join(root, 'data/listings.json'), 'utf8'));
  assert.deepEqual(data.listings.map((l) => l.itemId).sort(), ['balenciaga-city', 'chloe-paddington-lock']);
  assert.equal(data.listings.find((l) => l.itemId === 'balenciaga-city').matchedQuery, 'Balenciaga City');
  assert.equal(data.lastScan, now.toISOString());
  assert.equal(data.notify.configured, true);
  assert.deepEqual(await readdir(path.join(root, 'scanner/inbox')), []);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, 'Bag Tracker: 2 new');
});

test('dry run reports but changes nothing', async () => {
  const root = await setup({ 'cowork-1.json': cowork([{ url: 'https://www.carousell.ph/p/x-100001/', title: 'Bal City', price: 1 }]) });
  const out = await processInbox({ root, now, env: {}, dryRun: true });
  assert.equal(out.summary, '1 new');
  assert.deepEqual(await readdir(path.join(root, 'scanner/inbox')), ['cowork-1.json']);
  await assert.rejects(readFile(path.join(root, 'data/listings.json')));
});

test('test and invalid files are handled without touching listings', async () => {
  const root = await setup({ 'a-test.json': { source: 'test' }, 'b-bad.json': '{not json' });
  const out = await processInbox({ root, now, env: {} });
  assert.equal(out.results, 0);
  assert.equal(out.summary, 'no changes');
  assert.deepEqual(await readdir(path.join(root, 'scanner/inbox')), []);
  assert.deepEqual(await readdir(path.join(root, 'scanner/rejected')), ['b-bad.json']);
  const data = JSON.parse(await readFile(path.join(root, 'data/listings.json'), 'utf8'));
  assert.equal(data.lastScan, null);
  assert.deepEqual(data.listings, []);
});

test('no email is attempted when secrets are missing', async () => {
  const root = await setup({ 'cowork-1.json': cowork([{ url: 'https://www.carousell.ph/p/x-100001/', title: 'Bal City', price: 1 }]) });
  const out = await processInbox({ root, now, env: {} });
  assert.deepEqual(out.emailed, { sent: false, reason: 'Email secrets are not set' });
  assert.equal(out.data.notify.configured, false);
});

test('empty inbox does nothing', async () => {
  const root = await setup({});
  const out = await processInbox({ root, now, env: {} });
  assert.equal(out.entries, 0);
  await assert.rejects(readFile(path.join(root, 'data/listings.json')));
});
