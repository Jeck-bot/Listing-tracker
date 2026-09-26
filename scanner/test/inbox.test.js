import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identify, parsePrice, parsePosted, validateInboxFile } from '../lib/inbox.js';

const now = new Date('2026-09-26T10:00:00Z');

test('identify gives stable ids and strips tracking from Carousell links', () => {
  assert.deepEqual(identify('carousell', 'https://www.carousell.ph/p/chloe-paddington-bag-1234567890/?t-id=abc&ref=search'), {
    id: 'carousell-1234567890',
    url: 'https://www.carousell.ph/p/chloe-paddington-bag-1234567890/',
  });
  assert.equal(identify('carousell', 'https://carousell.ph/p/1234567890').id, 'carousell-1234567890');
  assert.equal(identify('carousell', 'http://www.carousell.ph/p/x-1234567890/').url, 'https://www.carousell.ph/p/x-1234567890/', 'http becomes https');
  assert.equal(identify('carousell', 'https://evil.example/p/x-1234567890/'), null, 'other hosts are rejected');
  assert.equal(identify('carousell', 'https://www.carousell.ph/search/chloe'), null, 'search pages are not listings');
  assert.equal(identify('carousell', 'javascript:alert(1)'), null);
  assert.equal(identify('fb_marketplace', 'https://www.facebook.com/marketplace/item/987654321/?ref=x').id, 'fb_marketplace-987654321');
});

test('identify accepts listing links however they were copied', () => {
  const want = { id: 'carousell-1300000001', url: 'https://www.carousell.ph/p/chloe-paddington-bag-1300000001/' };
  assert.deepEqual(identify('carousell', '/p/chloe-paddington-bag-1300000001/?t-id=x_1&t-referrer_request_id=y'), want, 'relative');
  assert.deepEqual(identify('carousell', 'www.carousell.ph/p/chloe-paddington-bag-1300000001'), want, 'no scheme');
  assert.deepEqual(identify('carousell', '//www.carousell.ph/p/chloe-paddington-bag-1300000001/'), want, 'protocol-relative');
  assert.deepEqual(identify('carousell', 'https://m.carousell.ph/p/chloe-paddington-bag-1300000001/#photos'), { ...want, url: 'https://www.carousell.ph/p/chloe-paddington-bag-1300000001/' }, 'mobile host');
  assert.deepEqual(identify('carousell', '  https://www.carousell.ph/p/1300000001  '), { id: 'carousell-1300000001', url: 'https://www.carousell.ph/p/1300000001/' }, 'id only');
});

test('identify never returns a search, profile or other page', () => {
  for (const url of [
    'https://www.carousell.ph/search/chloe%20paddington',
    '/search/balenciaga%20city?sort_by=3',
    'https://www.carousell.ph/u/closetbyjen/',
    'https://www.carousell.ph/categories/luxury-bags-20/',
    'https://www.carousell.ph/p/',
    'https://www.carousell.ph/p/chloe-paddington-bag/',
    'https://www.carousell.sg/p/chloe-paddington-bag-1300000001/',
    'https://www.carousell.ph.evil.example/p/x-1300000001/',
    'ftp://www.carousell.ph/p/x-1300000001/',
    '',
    null,
  ]) {
    assert.equal(identify('carousell', url), null, String(url));
  }
});

test('parsePrice reads numbers and peso strings', () => {
  assert.equal(parsePrice(25000), 25000);
  assert.equal(parsePrice('PHP 25,000'), 25000);
  assert.equal(parsePrice('₱1,250.50'), 1251);
  assert.equal(parsePrice('Free'), null);
  assert.equal(parsePrice(-5), null);
  assert.equal(parsePrice(null), null);
});

test('parsePosted turns relative times into ISO times', () => {
  assert.equal(parsePosted('3 hours ago', now.toISOString()), '2026-09-26T07:00:00.000Z');
  assert.equal(parsePosted('a day ago', now.toISOString()), '2026-09-25T10:00:00.000Z');
  assert.equal(parsePosted('yesterday', now.toISOString()), '2026-09-25T10:00:00.000Z');
  assert.equal(parsePosted('whenever', now.toISOString()), null);
});

test('valid results file is cleaned up and trimmed', () => {
  const { kind, result, warnings } = validateInboxFile(
    {
      source: 'cowork',
      runAt: '2026-09-26T09:58:00Z',
      platform: 'carousell',
      status: 'ok',
      complete: true,
      listings: [
        { url: 'https://www.carousell.ph/p/balenciaga-city-111111/', title: '  Balenciaga   City  ', price: '₱38,000', seller: 'shop', image: 'https://media.karousell.com/a.jpg', posted: '2 hours ago', searchTerm: 'balenciaga city' },
        { url: 'https://www.carousell.ph/p/balenciaga-city-111111/', title: 'duplicate' },
        { url: 'https://example.com/p/x-222222/', title: 'wrong host' },
        { url: 'https://www.carousell.ph/p/x-333333/', title: '' },
        { url: 'https://www.carousell.ph/p/x-444444/', title: 'bad image', image: 'javascript:alert(1)' },
      ],
      checks: [
        { url: 'https://www.carousell.ph/p/old-555555/', state: 'sold' },
        { url: 'https://www.carousell.ph/p/old-666666/', state: 'maybe' },
      ],
    },
    { now },
  );
  assert.equal(kind, 'results');
  assert.equal(result.listings.length, 2);
  assert.deepEqual(
    { ...result.listings[0] },
    {
      id: 'carousell-111111',
      platform: 'carousell',
      source: 'Carousell',
      url: 'https://www.carousell.ph/p/balenciaga-city-111111/',
      title: 'Balenciaga City',
      price: 38000,
      currency: 'PHP',
      condition: '',
      location: '',
      seller: 'shop',
      image: 'https://media.karousell.com/a.jpg',
      description: '',
      postedAt: '2026-09-26T07:58:00.000Z',
      searchTerm: 'balenciaga city',
    },
  );
  assert.equal(result.listings[1].image, null);
  assert.deepEqual(result.checks, [{ id: 'carousell-555555', state: 'sold' }]);
  assert.equal(result.complete, true);
  assert.equal(warnings.length, 3);
});

test('blocked file keeps the status but drops listings', () => {
  const { result } = validateInboxFile(
    { platform: 'carousell', status: 'blocked', message: 'Bot check shown', listings: [{ url: 'https://www.carousell.ph/p/x-123456/', title: 'x' }] },
    { now },
  );
  assert.equal(result.ok, false);
  assert.equal(result.listings.length, 0);
  assert.equal(result.message, 'Bot check shown');
});

test('test, request and invalid files are recognised', () => {
  assert.equal(validateInboxFile({ source: 'test' }, { now }).kind, 'test');
  assert.equal(validateInboxFile({ request: 'scan' }, { now }).kind, 'request');
  assert.equal(validateInboxFile({ platform: 'ebay', listings: [] }, { now }).kind, 'invalid');
  assert.equal(validateInboxFile([1, 2], { now }).kind, 'invalid');
});

test('a runAt in the future falls back to now', () => {
  const { result } = validateInboxFile({ platform: 'carousell', runAt: '2030-01-01T00:00:00Z', listings: [] }, { now });
  assert.equal(result.runAt, now.toISOString());
});
