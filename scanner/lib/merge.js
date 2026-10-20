/*
 * Folds one batch of results into the saved data: works out new listings,
 * price changes and sold listings, records events, and prunes old entries.
 */

const HOUR = 36e5;
const DAY = 24 * HOUR;
export const NEW_FOR_MS = DAY;
export const CHANGE_FOR_MS = 7 * DAY;
export const KEEP_REMOVED_MS = 30 * DAY;
export const KEEP_UNSEEN_MS = 30 * DAY;
export const KEEP_EVENTS_MS = 30 * DAY;
export const MAX_EVENTS = 300;
export const MAX_HISTORY = 10;

const UPDATABLE = ['title', 'url', 'image', 'condition', 'location', 'seller', 'source', 'itemId', 'matchedQuery', 'currency', 'postedAt', 'searchTerm'];

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const age = (now, iso) => now.getTime() - Date.parse(iso);

export function emptyData() {
  return { sample: false, lastScan: null, nextScan: null, sources: [], notify: { configured: false }, listings: [], events: [] };
}

function makeEvent(type, l, at, extra = {}) {
  return { type, listingId: l.id, itemId: l.itemId, platform: l.platform, title: l.title, url: l.url, at, ...extra };
}

function updatable(found) {
  const out = {};
  for (const key of UPDATABLE) {
    if (found[key] !== undefined && found[key] !== null && found[key] !== '') out[key] = found[key];
  }
  if (found.description) out.description = found.description;
  return out;
}

/** Status a listing should show at `now` (new and price-change badges expire). */
export function agedStatus(l, now) {
  if (l.status === 'new' && age(now, l.firstSeen) > NEW_FOR_MS) return 'unchanged';
  if ((l.status === 'price_drop' || l.status === 'price_up') && age(now, l.priceChangedAt || l.lastSeen) > CHANGE_FOR_MS) return 'unchanged';
  return l.status;
}

/**
 * prev: saved data. results: [{ platform, via, status, ok, complete, message, listings, checks }]
 * with listings already matched to watchlist items (itemId + matchedQuery).
 */
export function mergeResults(prev, results, { now = new Date(), watchlist, intervalHours = 4 }) {
  const at = now.toISOString();
  const base = { ...emptyData(), ...prev };
  const byId = new Map(base.listings.map((l) => [l.id, { ...l }]));
  const itemIds = new Set((watchlist.items || []).map((i) => i.id));
  const events = [];
  const seen = new Set();
  const sources = new Map(base.sources.map((s) => [s.platform, { ...s }]));
  let checked = false;

  for (const r of results) {
    const src = sources.get(r.platform) || { platform: r.platform };
    Object.assign(src, { via: r.via, status: r.status, message: r.message || '', lastRun: at });
    if (!r.ok) {
      sources.set(r.platform, src);
      continue;
    }
    checked = true;
    src.lastOk = at;
    src.found = r.listings.length;
    sources.set(r.platform, src);

    for (const found of r.listings) {
      if (seen.has(found.id)) continue;
      seen.add(found.id);
      const old = byId.get(found.id);

      if (!old || old.status === 'removed') {
        const l = {
          ...found,
          firstSeen: at,
          lastSeen: at,
          status: 'new',
          previousPrice: null,
          priceChangedAt: null,
          missing: 0,
          priceHistory: isNum(found.price) ? [{ price: found.price, at }] : [],
        };
        delete l.removedAt;
        byId.set(found.id, l);
        events.push(makeEvent('new', l, at, { to: found.price, ...(old ? { relisted: true } : {}) }));
        continue;
      }

      const l = { ...old, ...updatable(found), lastSeen: at, missing: 0 };
      if (isNum(found.price) && isNum(old.price) && found.price !== old.price) {
        l.previousPrice = old.price;
        l.price = found.price;
        l.priceChangedAt = at;
        l.status = found.price < old.price ? 'price_drop' : 'price_up';
        l.priceHistory = [...(old.priceHistory || []), { price: found.price, at }].slice(-MAX_HISTORY);
        events.push(makeEvent(l.status, l, at, { from: old.price, to: found.price }));
      } else if (isNum(found.price) && !isNum(old.price)) {
        l.price = found.price;
        l.priceHistory = [...(old.priceHistory || []), { price: found.price, at }].slice(-MAX_HISTORY);
      }
      byId.set(found.id, l);
    }

    for (const c of r.checks || []) {
      const l = byId.get(c.id);
      if (!l || l.status === 'removed' || seen.has(c.id)) continue;
      if (c.state === 'sold' || c.state === 'gone') {
        l.status = 'removed';
        l.removedAt = at;
        l.removedReason = c.state;
        events.push(makeEvent('removed', l, at, { from: l.price, reason: c.state }));
      } else {
        l.lastSeen = at;
        l.missing = 0;
      }
    }

    if (r.complete) {
      for (const l of byId.values()) {
        if (l.platform === r.platform && !seen.has(l.id) && l.status !== 'removed' && l.lastSeen !== at) l.missing = (l.missing || 0) + 1;
      }
    }
  }

  const listings = [...byId.values()]
    .map((l) => {
      const status = agedStatus(l, now);
      return status === l.status ? l : { ...l, status, previousPrice: null };
    })
    .filter((l) => {
      if (!itemIds.has(l.itemId)) return false;
      if (l.status === 'removed') return age(now, l.removedAt || l.lastSeen) <= KEEP_REMOVED_MS;
      return age(now, l.lastSeen) <= KEEP_UNSEEN_MS;
    })
    .sort((a, b) => Date.parse(b.firstSeen) - Date.parse(a.firstSeen));

  const allEvents = [...events, ...base.events]
    .filter((e) => age(now, e.at) <= KEEP_EVENTS_MS)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, MAX_EVENTS);

  const lastScan = checked ? at : base.lastScan;
  const hours = Math.min(24, Math.max(1, Math.round(Number(intervalHours) || 4)));
  return {
    data: {
      ...base,
      sample: false,
      lastScan,
      nextScan: lastScan ? new Date(Date.parse(lastScan) + hours * HOUR).toISOString() : null,
      sources: [...sources.values()],
      listings,
      events: allEvents,
    },
    events,
  };
}

/** "2 new, 1 price drop" style summary. */
export function summarize(events) {
  const count = (t) => events.filter((e) => e.type === t).length;
  const parts = [];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (count('new')) parts.push(`${count('new')} new`);
  if (count('price_drop')) parts.push(plural(count('price_drop'), 'price drop', 'price drops'));
  if (count('price_up')) parts.push(plural(count('price_up'), 'price increase', 'price increases'));
  if (count('removed')) parts.push(`${count('removed')} sold or removed`);
  return parts.length ? parts.join(', ') : 'no changes';
}
