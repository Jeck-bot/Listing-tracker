import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchItem, normalize } from '../lib/match.js';

const watchlist = JSON.parse(readFileSync(new URL('../../config/watchlist.json', import.meta.url)));
const itemFor = (title, price = 10000) => matchItem({ title, price }, watchlist)?.id ?? null;

test('normalize strips accents, case and punctuation', () => {
  assert.equal(normalize('  CHLOÉ Paddington — Bag!! '), 'chloe paddington bag');
  assert.equal(normalize('Lock & Key 1:1'), 'lock & key 1:1');
});

test('Chloe Paddington bags', () => {
  assert.equal(itemFor('Chloé Paddington Bag Brown'), 'chloe-paddington');
  assert.equal(itemFor('Authentic Chloe Paddington satchel with lock and key'), 'chloe-paddington');
  assert.equal(itemFor('chloe paddington (lock not included)'), 'chloe-paddington');
  assert.equal(itemFor('CHLOE-PADDINGTON medium'), 'chloe-paddington');
});

test('Chloe Paddington lock and key sold on its own', () => {
  assert.equal(itemFor('Chloe Paddington Lock and Key'), 'chloe-paddington-lock');
  assert.equal(itemFor('Authentic Chloé padlock with 2 keys'), 'chloe-paddington-lock');
  assert.equal(itemFor('Chloe padlock and key for Paddington bag'), 'chloe-paddington-lock');
  assert.equal(itemFor('Chloe Paddington bag lock only'), 'chloe-paddington-lock');
  assert.equal(itemFor('Chloe lock & key, no bag'), 'chloe-paddington-lock');
});

test('Balenciaga City, including balen / bal shorthand', () => {
  assert.equal(itemFor('Balenciaga Classic City Bag Black'), 'balenciaga-city');
  assert.equal(itemFor('Balen City Giant 12 gold hardware'), 'balenciaga-city');
  assert.equal(itemFor('Bal City mini'), 'balenciaga-city');
  assert.equal(itemFor('Balenciaga City bag - meetup Makati City'), 'balenciaga-city');
});

test('place names and other models do not count as City', () => {
  assert.equal(itemFor('Balenciaga Everyday tote Quezon City'), null);
  assert.equal(itemFor('Balenciaga Town bag'), null);
  assert.equal(itemFor('Balenciaga Triple S sneakers city edition'), null);
  assert.equal(itemFor('Global City bag sale'), null);
});

test('buy requests and fakes are skipped', () => {
  assert.equal(itemFor('WTB Chloe Paddington'), null);
  assert.equal(itemFor('LF Balenciaga City'), null);
  assert.equal(itemFor('Balenciaga City class A'), null);
  assert.equal(itemFor('Chloe Paddington mirror quality'), null);
  assert.equal(itemFor('Chloe Paddington inspired bag'), null);
});

test('unrelated listings do not match', () => {
  assert.equal(itemFor('Chloe Marcie bag'), null);
  assert.equal(itemFor('Balenciaga Le Cagole'), null);
  assert.equal(itemFor(''), null);
});

test('price limits apply when set', () => {
  const limited = { ...watchlist, items: watchlist.items.map((i) => ({ ...i, maxPrice: 50000 })) };
  assert.equal(matchItem({ title: 'Balenciaga City', price: 60000 }, limited), null);
  assert.equal(matchItem({ title: 'Balenciaga City', price: 40000 }, limited)?.id, 'balenciaga-city');
  assert.equal(matchItem({ title: 'Balenciaga City', price: null }, limited)?.id, 'balenciaga-city');
});
