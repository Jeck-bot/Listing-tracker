/*
 * Reads result files that Claude (the Cowork task) drops in scanner/inbox/.
 * Everything in them came from web pages, so it is validated and trimmed here
 * before it can reach the data file or the dashboard.
 */
import { readdir, readFile, unlink, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

export const PLATFORM_HOSTS = {
  carousell: ['carousell.ph'],
  fb_marketplace: ['facebook.com'],
  fb_group: ['facebook.com'],
};
const STATUSES = new Set(['ok', 'partial', 'blocked']);
const CHECK_STATES = new Set(['sold', 'gone', 'available', 'reserved']);
const MAX_LISTINGS = 300;
const MAX_CHECKS = 20;

function parseUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    return u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

function onHost(u, platform) {
  return (PLATFORM_HOSTS[platform] || []).some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
}

/** Stable id + clean link (no tracking parameters) for a listing URL, or null if it isn't one. */
export function identify(platform, rawUrl) {
  const u = parseUrl(rawUrl);
  if (!u || !onHost(u, platform)) return null;
  let m;
  if (platform === 'carousell' && (m = u.pathname.match(/^\/p\/((?:[^/]*?-)?(\d{5,}))\/?$/))) {
    return { id: `carousell-${m[2]}`, url: `https://www.carousell.ph/p/${m[1]}/` };
  }
  if (platform === 'fb_marketplace' && (m = u.pathname.match(/^\/marketplace\/item\/(\d+)/))) {
    return { id: `fb_marketplace-${m[1]}`, url: `https://www.facebook.com/marketplace/item/${m[1]}/` };
  }
  if (platform === 'fb_group' && (m = u.pathname.match(/^\/groups\/([^/]+)\/(?:posts|permalink)\/(\d+)/))) {
    return { id: `fb_group-${m[1]}-${m[2]}`, url: `https://www.facebook.com/groups/${m[1]}/posts/${m[2]}/` };
  }
  return null;
}

export function parsePrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[^\d.]/g, '').replace(/\.(?=.*\.)/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

const UNIT_MS = { minute: 6e4, min: 6e4, hour: 36e5, hr: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 };

/** Turns "3 hours ago" / "yesterday" style text into an ISO time relative to runAt. */
export function parsePosted(value, runAt) {
  if (typeof value !== 'string') return null;
  const base = Date.parse(runAt);
  if (Number.isNaN(base)) return null;
  const v = value.toLowerCase().trim();
  const iso = Date.parse(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(iso)) return new Date(iso).toISOString();
  if (/just now|moments? ago/.test(v)) return new Date(base).toISOString();
  if (/yesterday/.test(v)) return new Date(base - 864e5).toISOString();
  const m = v.match(/(\d+|an?)\s*(minute|min|hour|hr|day|week|month|year)s?\s*ago/);
  if (!m) return null;
  const n = m[1] === 'a' || m[1] === 'an' ? 1 : Number(m[1]);
  return new Date(base - n * UNIT_MS[m[2]]).toISOString();
}

function text(value, max) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/**
 * Validates one parsed inbox file.
 * Returns { kind: 'results' | 'request' | 'test' | 'invalid', result?, warnings }.
 */
export function validateInboxFile(json, { now = new Date() } = {}) {
  const warnings = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { kind: 'invalid', warnings: ['File is not a JSON object'] };
  if (json.source === 'test') return { kind: 'test', warnings };
  if (json.request && !Array.isArray(json.listings)) return { kind: 'request', warnings };

  const platform = json.platform;
  if (!PLATFORM_HOSTS[platform]) return { kind: 'invalid', warnings: [`Unknown platform "${platform}"`] };
  const status = STATUSES.has(json.status) ? json.status : 'ok';
  const runAtMs = Date.parse(json.runAt);
  const runAt = Number.isNaN(runAtMs) || runAtMs > now.getTime() + 6e5 ? now.toISOString() : new Date(runAtMs).toISOString();

  const listings = [];
  const seen = new Set();
  for (const raw of (Array.isArray(json.listings) ? json.listings : []).slice(0, MAX_LISTINGS)) {
    const ident = raw && identify(platform, raw.url);
    const title = text(raw?.title, 200);
    if (!ident || !title) {
      warnings.push(`Skipped a listing without a valid ${platform} link or title: ${text(raw?.url, 120) || '(no link)'}`);
      continue;
    }
    if (seen.has(ident.id)) continue;
    seen.add(ident.id);
    const image = parseUrl(raw.image);
    listings.push({
      id: ident.id,
      platform,
      source: platform === 'fb_group' ? text(raw.group, 120) || 'Facebook group' : platform === 'carousell' ? 'Carousell' : 'Marketplace',
      url: ident.url,
      title,
      price: parsePrice(raw.price),
      currency: 'PHP',
      condition: text(raw.condition, 60),
      location: text(raw.location, 80),
      seller: platform === 'carousell' ? text(raw.seller, 60) : '',
      image: image ? image.href : null,
      description: text(raw.description, 1000),
      postedAt: parsePosted(raw.posted, runAt),
      searchTerm: text(raw.searchTerm, 80),
    });
  }

  const checks = [];
  for (const raw of (Array.isArray(json.checks) ? json.checks : []).slice(0, MAX_CHECKS)) {
    const ident = raw && identify(platform, raw.url);
    if (!ident || !CHECK_STATES.has(raw.state)) {
      warnings.push(`Skipped a check without a valid link or state: ${text(raw?.url, 120) || '(no link)'}`);
      continue;
    }
    checks.push({ id: ident.id, state: raw.state });
  }

  return {
    kind: 'results',
    warnings,
    result: {
      platform,
      via: text(json.source, 30) || 'claude',
      status,
      ok: status !== 'blocked',
      complete: json.complete === true && status === 'ok',
      message: text(json.message, 200),
      runAt,
      searches: Array.isArray(json.searches) ? json.searches.slice(0, 20).map((s) => ({ term: text(s?.term, 80), results: Number(s?.results) || 0 })) : [],
      listings: status === 'blocked' ? [] : listings,
      checks: status === 'blocked' ? [] : checks,
    },
  };
}

/** Reads every *.json file in the inbox folder (oldest name first). */
export async function readInbox(dir, { now = new Date() } = {}) {
  let names = [];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const entries = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let json;
    try {
      json = JSON.parse(await readFile(file, 'utf8'));
    } catch (err) {
      entries.push({ file, kind: 'invalid', warnings: [`Not valid JSON: ${err.message}`] });
      continue;
    }
    entries.push({ file, ...validateInboxFile(json, { now }) });
  }
  return entries;
}

/** Deletes processed files; moves invalid ones to rejectedDir so they can be looked at. */
export async function clearInbox(entries, rejectedDir) {
  for (const e of entries) {
    if (e.kind === 'invalid') {
      await mkdir(rejectedDir, { recursive: true });
      await rename(e.file, path.join(rejectedDir, path.basename(e.file)));
    } else {
      await unlink(e.file);
    }
  }
}
