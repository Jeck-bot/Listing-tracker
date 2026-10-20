import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyData, mergeResults, summarize, agedStatus } from '../lib/merge.js';

const watchlist = { items: [{ id: 'balenciaga-city', label: 'Balenciaga City' }, { id: 'chloe-paddington', label: 'Chloe Paddington bag' }] };
const t0 = new Date('2026-09-26T00:00:00Z');
const later = (hours) => new Date(t0.getTime() + hours * 36e5);

function listing(id, price, extra = {}) {
  return { id: `carousell-${id}`, platform: 'carousell', source: 'Carousell', url: `https://www.carousell.ph/p/x-${id}/`, title: `Balenciaga City ${id}`, price, itemId: 'balenciaga-city', matchedQuery: 'Balenciaga City', ...extra };
}
function result(listings, extra = {}) {
  return { platform: 'carousell', via: 'cowork', status: 'ok', ok: true, complete: true, message: '', listings, checks: [], ...extra };
}
const run = (prev, results, now) => mergeResults(prev, results, { now, watchlist, intervalHours: 4 });

test('first sighting creates a new listing and a "new" event', () => {
  const { data, events } = run(emptyData(), [result([listing(1, 30000)])], t0);
  assert.equal(data.listings.length, 1);
  assert.equal(data.listings[0].status, 'new');
  assert.equal(data.listings[0].firstSeen, t0.toISOString());
  assert.deepEqual(events.map((e) => e.type), ['new']);
  assert.equal(events[0].title, 'Balenciaga City 1');
  assert.equal(data.lastScan, t0.toISOString());
  assert.equal(data.nextScan, later(4).toISOString());
  assert.equal(data.sources[0].status, 'ok');
  assert.equal(data.sources[0].found, 1);
});

test('a daily schedule puts the next check 24 h out; longer intervals are capped at 24 h', () => {
  const daily = mergeResults(emptyData(), [result([listing(1, 30000)])], { now: t0, watchlist, intervalHours: 24 });
  assert.equal(daily.data.nextScan, later(24).toISOString());
  const weekly = mergeResults(emptyData(), [result([listing(1, 30000)])], { now: t0, watchlist, intervalHours: 168 });
  assert.equal(weekly.data.nextScan, later(24).toISOString());
});

test('price drop and increase are detected with the old price kept', () => {
  let { data } = run(emptyData(), [result([listing(1, 30000), listing(2, 20000)])], t0);
  const next = run(data, [result([listing(1, 27000), listing(2, 21000)])], later(4));
  const byId = Object.fromEntries(next.data.listings.map((l) => [l.id, l]));
  assert.equal(byId['carousell-1'].status, 'price_drop');
  assert.equal(byId['carousell-1'].previousPrice, 30000);
  assert.equal(byId['carousell-2'].status, 'price_up');
  assert.deepEqual(next.events.map((e) => [e.type, e.from, e.to]), [['price_drop', 30000, 27000], ['price_up', 20000, 21000]]);
  assert.equal(byId['carousell-1'].priceHistory.length, 2);
  assert.equal(summarize(next.events), '1 price drop, 1 price increase');
});

test('same price again is not an event; "new" expires after 24 h', () => {
  let { data } = run(emptyData(), [result([listing(1, 30000)])], t0);
  const next = run(data, [result([listing(1, 30000)])], later(25));
  assert.equal(next.events.length, 0);
  assert.equal(next.data.listings[0].status, 'unchanged');
  assert.equal(summarize(next.events), 'no changes');
});

test('dropping off the results does not mark a listing sold; a sold check does', () => {
  let { data } = run(emptyData(), [result([listing(1, 30000), listing(2, 25000)])], t0);
  let next = run(data, [result([listing(2, 25000)])], later(4));
  const one = next.data.listings.find((l) => l.id === 'carousell-1');
  assert.equal(one.status, 'new');
  assert.equal(one.missing, 1);
  next = run(next.data, [result([listing(2, 25000)], { checks: [{ id: 'carousell-1', state: 'sold' }] })], later(8));
  const sold = next.data.listings.find((l) => l.id === 'carousell-1');
  assert.equal(sold.status, 'removed');
  assert.deepEqual(next.events.map((e) => [e.type, e.from]), [['removed', 30000]]);
});

test('"available" check keeps a listing fresh', () => {
  let { data } = run(emptyData(), [result([listing(1, 30000)])], t0);
  const next = run(data, [result([], { checks: [{ id: 'carousell-1', state: 'available' }] })], later(4));
  const l = next.data.listings[0];
  assert.equal(l.missing, 0);
  assert.equal(l.lastSeen, later(4).toISOString());
});

test('a blocked source records its status and leaves listings alone', () => {
  let { data } = run(emptyData(), [result([listing(1, 30000)])], t0);
  const next = run(data, [result([], { status: 'blocked', ok: false, message: 'Bot check shown' })], later(4));
  assert.equal(next.data.listings.length, 1);
  assert.equal(next.data.lastScan, t0.toISOString(), 'a blocked run is not a completed scan');
  assert.equal(next.data.sources[0].status, 'blocked');
  assert.equal(next.data.sources[0].message, 'Bot check shown');
  assert.equal(next.events.length, 0);
});

test('a removed listing that reappears counts as new again', () => {
  let { data } = run(emptyData(), [result([listing(1, 30000)])], t0);
  data = run(data, [result([], { checks: [{ id: 'carousell-1', state: 'gone' }] })], later(4)).data;
  const next = run(data, [result([listing(1, 29000)])], later(8));
  assert.equal(next.data.listings[0].status, 'new');
  assert.equal(next.events[0].relisted, true);
});

test('old removed listings, stale listings, dropped items and old events are pruned', () => {
  let { data } = run(emptyData(), [result([listing(1, 30000), listing(2, 20000), listing(3, 10000, { itemId: 'gone-item' })])], t0);
  data = run(data, [result([listing(2, 20000)], { checks: [{ id: 'carousell-1', state: 'sold' }] })], later(1)).data;
  const next = run(data, [result([])], later(24 * 32));
  assert.equal(next.data.listings.length, 0);
  assert.equal(next.data.events.length, 0);
});

test('agedStatus expires price-change badges after 7 days', () => {
  const l = { status: 'price_drop', priceChangedAt: t0.toISOString(), lastSeen: t0.toISOString(), firstSeen: t0.toISOString() };
  assert.equal(agedStatus(l, later(24 * 6)), 'price_drop');
  assert.equal(agedStatus(l, later(24 * 8)), 'unchanged');
});
