/*
 * Bag Tracker dashboard.
 * Reads data/listings.json (written by the scanner), config/watchlist.json and config/settings.json.
 * No build step: this file runs as-is in the browser.
 */
(() => {
  'use strict';

  const PATHS = {
    listings: 'data/listings.json',
    watchlist: 'config/watchlist.json',
    settings: 'config/settings.json',
  };
  const RELOAD_EVERY_MS = 5 * 60 * 1000;
  const TICK_MS = 30 * 1000;
  const WATCH_FOR_MS = 15 * 60 * 1000;
  const WATCH_EVERY_MS = 30 * 1000;
  const DAY_MS = 864e5;
  const TZ = 'Asia/Manila';
  const TABS = ['listings', 'changes', 'watchlist', 'settings'];
  const PANEL_EVENT_LIMIT = 12;

  const PLATFORMS = {
    carousell: { short: 'Carousell', long: 'Carousell' },
    fb_marketplace: { short: 'Marketplace', long: 'FB Marketplace' },
    fb_group: { short: 'FB Group', long: 'FB Groups' },
  };
  const STATUSES = {
    new: 'New',
    price_drop: 'Price drop',
    price_up: 'Price up',
    unchanged: 'No change',
    removed: 'Sold or removed',
  };
  const EVENT_LABELS = {
    new: 'New listing',
    price_drop: 'Price drop',
    price_up: 'Price up',
    removed: 'Sold or removed',
  };
  const EVENT_ICONS = { new: 'plus', price_drop: 'down', price_up: 'up', removed: 'x' };
  const NOTIFY_KEYS = { newListing: 'new', priceDrop: 'price_drop', priceIncrease: 'price_up', removed: 'removed' };
  const SORTS = {
    newest: 'Newest first',
    price_asc: 'Price: low to high',
    price_desc: 'Price: high to low',
    drop: 'Biggest price drop',
  };
  const COMPARE = {
    newest: (a, b) => time(b.firstSeen) - time(a.firstSeen),
    price_asc: (a, b) => priceOr(a, Infinity) - priceOr(b, Infinity),
    price_desc: (a, b) => priceOr(b, -Infinity) - priceOr(a, -Infinity),
    drop: (a, b) => priceDrop(b) - priceDrop(a) || time(b.firstSeen) - time(a.firstSeen),
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const desktop = window.matchMedia('(min-width: 1024px)');

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem('bag-tracker:' + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('bag-tracker:' + key, JSON.stringify(value));
      } catch {
        /* storage unavailable: preferences just won't persist */
      }
    },
  };

  const state = {
    data: null,
    watchlist: [],
    settings: {},
    tab: 'listings',
    platforms: new Set(), // empty = all platforms
    statuses: new Set(), // empty = all statuses
    search: '',
    minPrice: null,
    maxPrice: null,
    query: '',
    sort: SORTS[store.get('sort')] ? store.get('sort') : 'newest',
    layout: store.get('layout', 'grid') === 'table' ? 'table' : 'grid',
    open: new Set(),
    sampleOffset: null,
    loading: false,
    watchUntil: 0,
    watchTimer: null,
    watchMark: '',
  };

  /* ---------- Formatting ---------- */

  const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 });
  const clockFmt = new Intl.DateTimeFormat('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat('en-PH', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
  const dateTimeFmt = new Intl.DateTimeFormat('en-PH', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

  function time(iso) {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? 0 : t;
  }
  function isNum(n) {
    return typeof n === 'number' && Number.isFinite(n);
  }
  function priceOr(l, fallback) {
    return isNum(l.price) ? l.price : fallback;
  }
  function priceDrop(l) {
    return isNum(l.previousPrice) && isNum(l.price) ? l.previousPrice - l.price : 0;
  }
  function fmtPrice(n) {
    return isNum(n) ? peso.format(n) : 'No price';
  }
  function pctChange(from, to) {
    if (!isNum(from) || !isNum(to) || from === 0) return '';
    const pct = Math.abs((to - from) / from) * 100;
    return pct < 1 ? '<1%' : Math.round(pct) + '%';
  }
  function ago(iso) {
    const min = Math.round((Date.now() - time(iso)) / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    return dayFmt.format(new Date(iso));
  }
  function until(iso) {
    const min = Math.round((time(iso) - Date.now()) / 60000);
    if (min <= 0) return 'due now';
    if (min < 60) return `in ${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `in ${h} h ${m} min` : `in ${h} h`;
  }
  function clock(iso) {
    return clockFmt.format(new Date(iso));
  }
  function dayLabel(iso) {
    const key = dayKeyFmt.format(new Date(iso));
    const today = dayKeyFmt.format(new Date());
    const yesterday = dayKeyFmt.format(new Date(Date.now() - 864e5));
    if (key === today) return 'Today';
    if (key === yesterday) return 'Yesterday';
    return dayFmt.format(new Date(iso));
  }
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function safeUrl(url) {
    return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
  }
  function domId(id) {
    return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
  }
  function hash(str) {
    let h = 0;
    for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return Math.abs(h);
  }
  function icon(name) {
    return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  }
  function agoTag(iso, prefix = '') {
    return `<time datetime="${esc(iso)}" data-ago="${esc(iso)}" data-prefix="${esc(prefix)}" title="${esc(dateTimeFmt.format(new Date(iso)))} PHT">${esc(prefix + ago(iso))}</time>`;
  }

  function platformEnabled(key) {
    return state.settings.platforms?.[key]?.enabled !== false;
  }
  // Platforms shown in chips and filters: switched on, or still holding listings.
  function activePlatforms() {
    return Object.entries(PLATFORMS).filter(([key]) => platformEnabled(key) || state.data?.listings.some((l) => l.platform === key));
  }
  function repoUrl(path = '') {
    const gh = state.settings.github || {};
    const base = gh.owner && gh.repo ? `https://github.com/${gh.owner}/${gh.repo}` : 'https://github.com';
    return base + path;
  }

  /* ---------- Data ---------- */

  async function fetchJSON(path) {
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${path} returned ${res.status}`);
    return res.json();
  }

  // Sample timestamps are fixed in the file; shift them so the last scan always looks recent.
  function rebaseSample(data) {
    if (state.sampleOffset === null) state.sampleOffset = Date.now() - 18 * 60000 - time(data.lastScan);
    const shift = (iso) => (iso ? new Date(time(iso) + state.sampleOffset).toISOString() : iso);
    data.lastScan = shift(data.lastScan);
    data.nextScan = shift(data.nextScan);
    data.listings.forEach((l) => {
      for (const key of ['firstSeen', 'lastSeen', 'priceChangedAt', 'removedAt']) l[key] = shift(l[key]);
    });
    data.events.forEach((e) => {
      e.at = shift(e.at);
    });
    data.sources.forEach((src) => {
      src.lastRun = shift(src.lastRun);
      src.lastOk = shift(src.lastOk);
    });
  }

  // "New" and price-change badges expire even if no scan has run since.
  function ageStatuses(data) {
    const now = Date.now();
    data.listings.forEach((l) => {
      if (l.status === 'new' && now - time(l.firstSeen) > DAY_MS) l.status = 'unchanged';
      if ((l.status === 'price_drop' || l.status === 'price_up') && now - time(l.priceChangedAt || l.lastSeen) > 7 * DAY_MS) {
        l.status = 'unchanged';
        l.previousPrice = null;
      }
    });
  }

  // Changes whenever a scan result has been processed (even one that found nothing).
  function dataMark(data) {
    return [data.lastScan, ...data.sources.map((s) => s.lastRun)].join('|');
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    $('#reload').setAttribute('aria-busy', 'true');
    try {
      const [data, watchlist, settings] = await Promise.all([
        fetchJSON(PATHS.listings),
        fetchJSON(PATHS.watchlist).catch(() => ({ items: [] })),
        fetchJSON(PATHS.settings).catch(() => ({})),
      ]);
      data.listings = Array.isArray(data.listings) ? data.listings : [];
      data.events = Array.isArray(data.events) ? data.events : [];
      data.sources = Array.isArray(data.sources) ? data.sources : [];
      if (data.sample) rebaseSample(data);
      ageStatuses(data);
      const mark = dataMark(data);
      const arrived = state.watchUntil > Date.now() && state.watchMark && mark !== state.watchMark;
      state.data = data;
      state.watchlist = Array.isArray(watchlist.items) ? watchlist.items : [];
      state.settings = settings || {};
      state.loadedAt = Date.now();
      $('#error').hidden = true;
      renderAll();
      if (arrived) resultsArrived();
    } catch (err) {
      showError(err);
    } finally {
      state.loading = false;
      $('#reload').removeAttribute('aria-busy');
    }
  }

  function showError(err) {
    const box = $('#error');
    const fromDisk = location.protocol === 'file:';
    box.innerHTML = fromDisk
      ? '<strong>The listings could not load.</strong> Browsers block data files on pages opened straight from disk. Open the dashboard through GitHub Pages, or run <code>python3 -m http.server</code> in the project folder and visit <code>localhost:8000</code>.'
      : `<strong>The listings could not load.</strong> ${esc(err.message)}. Tap Reload to try again.`;
    box.hidden = false;
    if (!state.data) $('#scan-text').textContent = 'No data yet';
  }

  /* ---------- Filtering ---------- */

  function listingMatches(l, { ignorePlatform = false, ignoreStatus = false } = {}) {
    if (!ignorePlatform && state.platforms.size && !state.platforms.has(l.platform)) return false;
    if (!ignoreStatus && state.statuses.size && !state.statuses.has(l.status)) return false;
    if (state.query && l.matchedQuery !== state.query) return false;
    if (state.minPrice !== null && !(isNum(l.price) && l.price >= state.minPrice)) return false;
    if (state.maxPrice !== null && !(isNum(l.price) && l.price <= state.maxPrice)) return false;
    if (state.search) {
      const hay = [l.title, l.description, l.source, l.location, l.seller, l.matchedQuery, l.condition].join(' ').toLowerCase();
      const words = state.search.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  }

  function visibleListings() {
    const cmp = COMPARE[state.sort] || COMPARE.newest;
    return state.data.listings
      .filter((l) => listingMatches(l))
      .sort((a, b) => (a.status === 'removed') - (b.status === 'removed') || cmp(a, b));
  }

  function activeFilterCount() {
    return (state.statuses.size ? 1 : 0) + (state.query ? 1 : 0) + (state.minPrice !== null || state.maxPrice !== null ? 1 : 0);
  }

  function clearFilters() {
    state.platforms.clear();
    state.statuses.clear();
    state.query = '';
    state.minPrice = null;
    state.maxPrice = null;
    state.search = '';
    $('#search').value = '';
    syncFilterControls();
    renderListingsArea();
  }

  // Checkbox groups keep "empty set = everything" so new platforms/statuses show by default.
  // Unchecking every box stores a sentinel so nothing matches.
  function setFromChecks(name, allKeys) {
    const checked = $$(`input[name="${name}"]:checked`, $('#filters')).map((i) => i.value);
    if (checked.length === 0) return new Set(['none']);
    return new Set(checked.length === allKeys.length ? [] : checked);
  }

  /* ---------- Rendering: header + stats ---------- */

  function renderAll() {
    $('#sample-banner').hidden = !state.data.sample;
    renderHeader();
    buildFilters();
    renderListingsArea();
    renderChanges();
    renderWatchlist();
    renderSettings();
    applyTab();
  }

  function renderHeader() {
    const { lastScan, nextScan, sources } = state.data;
    const blocked = sources.find((s) => s.status === 'blocked' && s.lastRun && (!lastScan || time(s.lastRun) >= time(lastScan)));
    const overdue = lastScan && nextScan && Date.now() - time(nextScan) > 30 * 60000;
    const watching = state.watchUntil > Date.now();
    let text;
    if (watching) text = 'Waiting for new results…';
    else if (!lastScan) text = 'Not checked yet';
    else text = `Checked ${ago(lastScan)}${overdue ? ' · next check overdue' : nextScan ? ` · next ${until(nextScan)}` : ''}`;
    if (blocked && !watching) text += ` · ${PLATFORMS[blocked.platform]?.long || 'A site'} blocked the last check`;
    $('#scan-text').textContent = text;
    $('#scan-status').title = lastScan ? `Last check ${dateTimeFmt.format(new Date(lastScan))} PHT` : '';
    $('#live-dot').classList.toggle('is-late', Boolean(!watching && (overdue || blocked || !lastScan)));
    $('#live-dot').classList.toggle('is-watching', watching);
  }

  function renderStats() {
    const all = state.data.listings;
    const count = (status) => all.filter((l) => l.status === status).length;
    const live = all.filter((l) => l.status !== 'removed');
    const livePlatforms = new Set(live.map((l) => l.platform)).size;
    const only = state.statuses.size === 1 ? [...state.statuses][0] : null;
    const liveOnly = state.statuses.size === 4 && !state.statuses.has('removed');
    const tiles = [
      { key: 'new', mark: 'new', label: 'New', value: count('new'), note: 'found in the last 24 h', pressed: only === 'new' },
      { key: 'price_drop', mark: 'drop', label: 'Price drops', value: count('price_drop'), note: 'cheaper than first seen', pressed: only === 'price_drop' },
      { key: 'live', mark: 'live', label: 'Tracking', value: live.length, note: `live on ${livePlatforms} platform${livePlatforms === 1 ? '' : 's'}`, pressed: liveOnly },
      { key: 'removed', mark: 'removed', label: 'Sold or removed', value: count('removed'), note: 'no longer listed', pressed: only === 'removed' },
    ];
    $('#stats').innerHTML = tiles
      .map(
        (t) => `<button type="button" class="stat" data-stat="${t.key}" aria-pressed="${t.pressed}">
          <span class="stat-label"><span class="mark mark-${t.mark}" aria-hidden="true"></span>${esc(t.label)}</span>
          <span class="stat-value">${t.value.toLocaleString('en-PH')}</span>
          <span class="stat-note">${esc(t.note)}</span>
        </button>`
      )
      .join('');
  }

  function renderChips() {
    const counts = {};
    state.data.listings.forEach((l) => {
      if (listingMatches(l, { ignorePlatform: true })) counts[l.platform] = (counts[l.platform] || 0) + 1;
    });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const chip = (key, label, n, pressed) =>
      `<button type="button" class="chip" data-platform="${key}" aria-pressed="${pressed}">${key ? `<span class="plat plat-${key}"><span class="dot" aria-hidden="true"></span></span>` : ''}${esc(label)}<span class="n">${n}</span></button>`;
    $('#chips').innerHTML =
      chip('', 'All', total, state.platforms.size === 0) +
      activePlatforms()
        .map(([key, p]) => chip(key, p.long, counts[key] || 0, state.platforms.size > 0 && state.platforms.has(key)))
        .join('');
  }

  /* ---------- Rendering: listings ---------- */

  const BAG_SVG =
    '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M17 20v-5a7 7 0 0 1 14 0v5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M11.2 19h25.6a2 2 0 0 1 2 1.8l2 18a3 3 0 0 1-3 3.2H10.2a3 3 0 0 1-3-3.2l2-18a2 2 0 0 1 2-1.8z" fill="currentColor"/></svg>';

  function thumb(l) {
    const src = safeUrl(l.image);
    const img = src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '';
    return `<span class="thumb tone-${(hash(l.id) % 5) + 1}">${BAG_SVG}${img}</span>`;
  }

  function platformTag(platform) {
    const label = PLATFORMS[platform]?.short || platform;
    return `<span class="plat plat-${esc(platform)}"><span class="dot" aria-hidden="true"></span>${esc(label)}</span>`;
  }

  function statusPill(l) {
    switch (l.status) {
      case 'new':
        return '<span class="pill pill-new">New</span>';
      case 'price_drop':
        return `<span class="pill pill-drop" title="Price dropped">${icon('down')}${esc(pctChange(l.previousPrice, l.price))}<span class="sr-only"> price drop</span></span>`;
      case 'price_up':
        return `<span class="pill pill-up" title="Price went up">${icon('up')}${esc(pctChange(l.previousPrice, l.price))}<span class="sr-only"> price increase</span></span>`;
      case 'removed':
        return '<span class="pill pill-removed">Sold or removed</span>';
      default:
        return '';
    }
  }

  function priceLine(l) {
    const changed = isNum(l.previousPrice) && l.previousPrice !== l.price;
    return `<span class="price">${esc(fmtPrice(l.price))}</span>${changed ? `<s class="was"><span class="sr-only">was </span>${esc(fmtPrice(l.previousPrice))}</s>` : ''}`;
  }

  function fact(label, value) {
    return value ? `<dt>${esc(label)}</dt><dd>${value}</dd>` : '';
  }

  function listingCard(l) {
    const url = safeUrl(l.url);
    const where = PLATFORMS[l.platform]?.long || 'the site';
    const isOpen = state.open.has(l.id);
    const moreId = `more-${domId(l.id)}`;
    const who = l.platform === 'fb_group' ? l.source : l.seller;
    return `<article class="listing${isOpen ? ' open' : ''}${l.status === 'removed' ? ' is-removed' : ''}" id="listing-${domId(l.id)}" data-id="${esc(l.id)}">
      <button type="button" class="listing-main" aria-expanded="${isOpen}" aria-controls="${moreId}">
        ${thumb(l)}
        <span class="info">
          <span class="badges">${platformTag(l.platform)}${statusPill(l)}</span>
          <span class="title">${esc(l.title)}</span>
          <span class="price-line">${priceLine(l)}</span>
          <span class="meta">${l.location ? `<span>${esc(l.location)}</span>` : ''}${who ? `<span>${esc(who)}</span>` : ''}<span>${agoTag(l.firstSeen, 'found ')}</span></span>
        </span>
      </button>
      ${url ? `<a class="quick-open" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="Open listing on ${esc(where)}">${icon('external')}</a>` : ''}
      <div class="more" id="${moreId}">
        ${l.description ? `<p class="desc">${esc(l.description)}</p>` : ''}
        <dl class="facts">
          ${fact('Condition', esc(l.condition))}
          ${fact(l.platform === 'fb_group' ? 'Group' : 'Platform', esc(l.platform === 'fb_group' ? l.source : where))}
          ${fact('Seller', esc(l.seller))}
          ${fact('Watchlist', esc(l.matchedQuery))}
          ${fact('First found', l.firstSeen ? `${esc(dateTimeFmt.format(new Date(l.firstSeen)))} PHT` : '')}
          ${fact('Last checked', l.lastSeen ? agoTag(l.lastSeen) : '')}
        </dl>
        ${url ? `<a class="btn btn-primary open-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open on ${esc(where)} ${icon('external')}</a>` : ''}
      </div>
    </article>`;
  }

  function listingTable(list) {
    const rows = list
      .map((l) => {
        const url = safeUrl(l.url);
        const sub = [l.location, l.platform === 'fb_group' ? l.source : l.seller].filter(Boolean).join(' · ');
        return `<tr class="${l.status === 'removed' ? 'is-removed' : ''}">
          <td><div class="t-item">${thumb(l)}<div><div class="t-title">${esc(l.title)}</div><div class="t-sub">${esc(sub)}</div></div></div></td>
          <td>${platformTag(l.platform)}</td>
          <td class="num"><div class="t-price">${priceLine(l)}${statusPill(l)}</div></td>
          <td class="t-muted t-nowrap">${agoTag(l.firstSeen)}</td>
          <td>${url ? `<a class="btn btn-ghost btn-sm" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="Open listing on ${esc(PLATFORMS[l.platform]?.long || 'the site')}">Open ${icon('external')}</a>` : ''}</td>
        </tr>`;
      })
      .join('');
    return `<table class="table">
      <thead><tr><th scope="col">Item</th><th scope="col">Platform</th><th scope="col" class="num">Price</th><th scope="col">Found</th><th scope="col"><span class="sr-only">Link</span></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function renderListingsArea() {
    if (!state.data) return;
    renderStats();
    renderChips();
    updateFilterCounts();

    const list = visibleListings();
    const total = state.data.listings.length;
    const useTable = desktop.matches && state.layout === 'table';
    $('#result-count').textContent =
      list.length === total ? `${total} listing${total === 1 ? '' : 's'}` : `Showing ${list.length} of ${total} listings`;
    const noData = total === 0;
    if (noData) $('#result-count').textContent = 'No listings yet';
    $('#no-data').hidden = !noData;
    $('#empty').hidden = noData || list.length > 0;
    $('#list').hidden = useTable || list.length === 0;
    $('#table-wrap').hidden = !useTable || list.length === 0;
    if (useTable) $('#table-wrap').innerHTML = listingTable(list);
    else $('#list').innerHTML = list.map(listingCard).join('');

    $$('.view-toggle button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layout === state.layout)));
    const n = activeFilterCount();
    $('#filter-count').hidden = n === 0;
    $('#filter-count').textContent = n;
    const apply = $('#f-apply');
    if (apply) apply.textContent = `Show ${list.length} listing${list.length === 1 ? '' : 's'}`;
  }

  /* ---------- Filters panel ---------- */

  function buildFilters() {
    const queries = [...new Set([...state.watchlist.map((w) => w.label || w.query), ...state.data.listings.map((l) => l.matchedQuery)].filter(Boolean))];
    if (state.query && !queries.includes(state.query)) state.query = '';
    const check = (name, key, label, extra = '') =>
      `<label class="f-check"><input type="checkbox" name="${name}" value="${key}">${extra}<span>${esc(label)}</span><span class="n" data-count="${name}:${key}"></span></label>`;

    $('#filters').innerHTML = `
      <span class="sheet-handle" aria-hidden="true"></span>
      <div class="sheet-head">
        <h2>Filters</h2>
        <button type="button" class="icon-btn" data-close-sheet aria-label="Close filters">${icon('x')}</button>
      </div>
      <fieldset class="f-group f-platform">
        <legend class="f-legend">Platform</legend>
        ${activePlatforms().map(([k, p]) => check('platform', k, p.long, `<span class="plat plat-${k}"><span class="dot" aria-hidden="true"></span></span>`)).join('')}
      </fieldset>
      <fieldset class="f-group">
        <legend class="f-legend">Status</legend>
        ${Object.entries(STATUSES).map(([k, label]) => check('status', k, label)).join('')}
      </fieldset>
      <fieldset class="f-group">
        <legend class="f-legend">Price (₱)</legend>
        <div class="f-price">
          <label for="f-min">Minimum<input class="f-input" id="f-min" type="number" inputmode="numeric" min="0" step="500" placeholder="Any"></label>
          <label for="f-max">Maximum<input class="f-input" id="f-max" type="number" inputmode="numeric" min="0" step="500" placeholder="Any"></label>
        </div>
      </fieldset>
      <div class="f-group">
        <label class="f-legend" for="f-query">Watchlist item</label>
        <select class="f-select" id="f-query">
          <option value="">All items</option>
          ${queries.map((q) => `<option value="${esc(q)}">${esc(q)}</option>`).join('')}
        </select>
      </div>
      <div class="f-group">
        <label class="f-legend" for="f-sort">Sort</label>
        <select class="f-select" id="f-sort">
          ${Object.entries(SORTS).map(([k, label]) => `<option value="${k}">${esc(label)}</option>`).join('')}
        </select>
      </div>
      <button type="button" class="f-clear-link" data-clear-filters>Clear all filters</button>
      <div class="sheet-foot">
        <button type="button" class="btn btn-ghost" data-clear-filters>Clear</button>
        <button type="button" class="btn btn-primary" id="f-apply" data-close-sheet>Show listings</button>
      </div>`;
    syncFilterControls();
  }

  function syncFilterControls() {
    const root = $('#filters');
    if (!root.firstElementChild) return;
    $$('input[name="platform"]', root).forEach((i) => (i.checked = state.platforms.size === 0 || state.platforms.has(i.value)));
    $$('input[name="status"]', root).forEach((i) => (i.checked = state.statuses.size === 0 || state.statuses.has(i.value)));
    $('#f-min').value = state.minPrice ?? '';
    $('#f-max').value = state.maxPrice ?? '';
    $('#f-query').value = state.query;
    $('#f-sort').value = state.sort;
  }

  function updateFilterCounts() {
    const root = $('#filters');
    if (!root.firstElementChild) return;
    const counts = {};
    state.data.listings.forEach((l) => {
      if (listingMatches(l, { ignorePlatform: true })) counts['platform:' + l.platform] = (counts['platform:' + l.platform] || 0) + 1;
      if (listingMatches(l, { ignoreStatus: true })) counts['status:' + l.status] = (counts['status:' + l.status] || 0) + 1;
    });
    $$('[data-count]', root).forEach((el) => (el.textContent = counts[el.dataset.count] || 0));
  }

  function openSheet() {
    if (desktop.matches) return;
    $('#filters').classList.add('open');
    $('#sheet-backdrop').hidden = false;
    $('#open-filters').setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    $('#filters .icon-btn')?.focus();
  }

  function closeSheet({ restoreFocus = true } = {}) {
    const wasOpen = $('#filters').classList.contains('open');
    $('#filters').classList.remove('open');
    $('#sheet-backdrop').hidden = true;
    $('#open-filters').setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    if (wasOpen && restoreFocus) $('#open-filters').focus();
  }

  /* ---------- Changes ---------- */

  function eventLine(e, listing) {
    switch (e.type) {
      case 'new':
        return `<span class="tl-price">${esc(fmtPrice(e.to ?? listing?.price))}</span>`;
      case 'price_drop':
      case 'price_up':
        return `<span class="tl-price">${esc(fmtPrice(e.from))} → ${esc(fmtPrice(e.to))}</span>`;
      case 'removed':
        return `<span class="tl-price">last at ${esc(fmtPrice(e.from ?? listing?.price))}</span>`;
      default:
        return '';
    }
  }

  function timelineHTML(events) {
    if (!events.length) return '<li class="tl-empty">No changes yet. New listings, price changes and sold items show up here after each check.</li>';
    const byId = new Map(state.data.listings.map((l) => [l.id, l]));
    let lastDay = '';
    return events
      .map((e) => {
        const l = byId.get(e.listingId);
        const url = safeUrl(e.url);
        const title = l
          ? `<button type="button" class="tl-title" data-goto="${esc(l.id)}">${esc(l.title)}</button>`
          : url
            ? `<a class="tl-title" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(e.title || 'Listing')}</a>`
            : `<span class="tl-title">${esc(e.title || 'Listing no longer tracked')}</span>`;
        const platform = l?.platform || e.platform;
        const day = dayLabel(e.at);
        const heading = day !== lastDay ? `<li class="tl-day">${esc(day)}</li>` : '';
        lastDay = day;
        return `${heading}<li class="tl-item ev-${esc(e.type)}">
          <span class="tl-icon">${icon(EVENT_ICONS[e.type] || 'clock')}</span>
          <div class="tl-body">
            <span class="tl-kind"><strong>${esc(EVENT_LABELS[e.type] || e.type)}</strong></span>
            ${title}
            <span class="tl-meta">${platform ? platformTag(platform) : ''}${eventLine(e, l)}<span>${esc(clock(e.at))}</span></span>
          </div>
        </li>`;
      })
      .join('');
  }

  function sortedEvents() {
    return [...state.data.events].sort((a, b) => time(b.at) - time(a.at));
  }

  function renderChanges() {
    const events = sortedEvents();
    $('#changes-list').innerHTML = timelineHTML(events);
    $('#changes-panel-list').innerHTML = timelineHTML(events.slice(0, PANEL_EVENT_LIMIT));
    updateChangesBadge();
  }

  function updateChangesBadge() {
    if (!state.data) return;
    const seenAt = store.get('changesSeenAt', 0);
    const onChanges = state.tab === 'changes' || desktop.matches;
    if (onChanges) store.set('changesSeenAt', Date.now());
    const unseen = onChanges ? 0 : state.data.events.filter((e) => time(e.at) > seenAt).length;
    const badge = $('#changes-badge');
    badge.hidden = unseen === 0;
    badge.textContent = unseen > 99 ? '99+' : unseen;
    badge.setAttribute('aria-label', `${unseen} unseen`);
  }

  function goToListing(id) {
    state.platforms.clear();
    state.statuses.clear();
    state.query = '';
    state.minPrice = null;
    state.maxPrice = null;
    state.search = '';
    $('#search').value = '';
    state.open.add(id);
    syncFilterControls();
    if (desktop.matches && state.layout === 'table') {
      state.layout = 'grid';
      store.set('layout', 'grid');
    }
    setTab('listings', { scroll: false });
    renderListingsArea();
    const el = document.getElementById('listing-' + domId(id));
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    $('.listing-main', el).focus({ preventScroll: true });
  }

  /* ---------- Watchlist ---------- */

  function priceRange(item) {
    const min = isNum(item.minPrice) ? item.minPrice : null;
    const max = isNum(item.maxPrice) ? item.maxPrice : null;
    if (min !== null && max !== null) return `${fmtPrice(min)} to ${fmtPrice(max)}`;
    if (max !== null) return `Up to ${fmtPrice(max)}`;
    if (min !== null) return `From ${fmtPrice(min)}`;
    return 'Any price';
  }

  function renderWatchlist() {
    const items = state.watchlist;
    const intro = `<p class="note">Claude searches Carousell for every search term below, newest listings first, and keeps the ones whose titles match. Titles with "WTB", "class A", "replica" and similar are skipped. The list lives in <a href="${esc(repoUrl('/blob/main/config/watchlist.json'))}" target="_blank" rel="noopener noreferrer"><code>config/watchlist.json</code></a>.</p>`;
    if (!items.length) {
      $('#watchlist').innerHTML = `${intro}<div class="empty"><p><strong>No items yet.</strong></p><p>Add the bags you want tracked to <code>config/watchlist.json</code>.</p></div>`;
      return;
    }
    const cards = items
      .map((item) => {
        const label = item.label || item.query;
        const found = state.data.listings.filter((l) => (item.id && l.itemId === item.id) || l.matchedQuery === label);
        const live = found.filter((l) => l.status !== 'removed').length;
        const gone = found.length - live;
        const terms = item.searchTerms || item.keywords || [];
        return `<article class="card">
          <div class="card-head"><h2 class="card-title">${esc(label)}</h2>${item.example ? '<span class="tag">Example</span>' : ''}</div>
          <p class="wl-range">${esc(priceRange(item))}</p>
          ${terms.length ? `<div class="keys" aria-label="Search terms">${terms.map((k) => `<span class="key">${esc(k)}</span>`).join('')}</div>` : ''}
          <div class="wl-foot"><span>${live} live${gone ? ` · ${gone} sold or removed` : ''}</span>${found.length ? `<button type="button" class="btn btn-ghost btn-sm" data-show-query="${esc(label)}">Show listings</button>` : ''}</div>
        </article>`;
      })
      .join('');
    $('#watchlist').innerHTML = `${intro}<div class="cards">${cards}</div>`;
  }

  /* ---------- Settings ---------- */

  const SOURCE_STATUS = { ok: 'OK', partial: 'Partly done', blocked: 'Blocked' };

  function renderSettings() {
    const s = state.settings;
    const { lastScan, nextScan, sources, notify } = state.data;
    const rawHours = Number(s.scanIntervalHours);
    const hours = Number.isFinite(rawHours) ? Math.min(4, Math.max(1, Math.round(rawHours))) : 4;
    const notifyOn = s.notifyOn || {};
    const emailOn = Boolean(notify?.configured);
    const guide = repoUrl('/blob/main/docs/cowork-task.md');
    const overdue = lastScan && nextScan && Date.now() - time(nextScan) > 30 * 60000;

    const sourceRows = Object.entries(PLATFORMS)
      .map(([key]) => {
        const src = sources.find((x) => x.platform === key);
        let value;
        if (!platformEnabled(key)) value = '<span class="v-muted">Not connected yet</span>';
        else if (!src) value = '<span class="v-muted">Waiting for the first check</span>';
        else {
          const label = SOURCE_STATUS[src.status] || 'OK';
          const detail = src.status === 'blocked' ? '' : ` · ${src.found ?? 0} matched`;
          value = `<span class="pill pill-src pill-src-${esc(src.status || 'ok')}">${esc(label)}</span> ${src.lastRun ? agoTag(src.lastRun) : ''}${esc(detail)}`;
        }
        const note = src?.message && platformEnabled(key) ? `<span class="row-note">${esc(src.message)}</span>` : '';
        return `<div class="row"><span class="k">${platformTag(key)}</span><span class="v">${value}</span>${note}</div>`;
      })
      .join('');

    const alertTypes = Object.entries(NOTIFY_KEYS)
      .map(([k, type]) => {
        const on = Boolean(notifyOn[k]);
        return `<li class="${on ? 'on' : 'off'}">${icon(on ? 'check' : 'x')}<span>${esc(EVENT_LABELS[type])}</span><span class="sr-only">${on ? '(on)' : '(off)'}</span></li>`;
      })
      .join('');

    $('#settings').innerHTML = `
      <div class="cards">
        <section class="card" aria-labelledby="set-scan">
          <h2 class="card-title" id="set-scan">Check schedule</h2>
          <p><span class="big">Every ${hours} hour${hours === 1 ? '' : 's'}</span></p>
          <dl class="rows">
            <div class="row"><dt>Last check</dt><dd>${lastScan ? `${esc(clock(lastScan))} PHT <span class="v-muted">(${agoTag(lastScan)})</span>` : '<span class="v-muted">Not yet</span>'}</dd></div>
            <div class="row"><dt>Next check</dt><dd>${nextScan ? `${esc(clock(nextScan))} PHT <span class="v-muted">(${overdue ? 'overdue' : esc(until(nextScan))})</span>` : '<span class="v-muted">After the first check</span>'}</dd></div>
          </dl>
          <p class="hint">Checks run through your Claude Cowork task and need your computer on with the Claude app open. ${overdue ? '<strong>The last check is overdue.</strong> ' : ''}<a href="${esc(guide)}" target="_blank" rel="noopener noreferrer">Setup guide</a></p>
        </section>

        <section class="card" aria-labelledby="set-sources">
          <h2 class="card-title" id="set-sources">Platforms</h2>
          <div class="rows">${sourceRows}</div>
          <p class="hint">Carousell only shows listings to real browsers, so Claude searches it in the Claude app's browser. Philippine listings only.</p>
        </section>

        <section class="card" aria-labelledby="set-email">
          <h2 class="card-title" id="set-email">Email alerts</h2>
          <dl class="rows">
            <div class="row"><dt>Status</dt><dd>${emailOn ? 'On' : '<span class="v-muted">Not set up yet</span>'}</dd></div>
          </dl>
          <ul class="checks" aria-label="Email me about">${alertTypes}</ul>
          <p class="hint">${emailOn ? 'One email per check, only when something changed.' : 'Add the Gmail secrets on GitHub to turn this on (see the README). Until then, the Cowork task can email you through your Gmail connection.'}</p>
        </section>

        <section class="card" aria-labelledby="set-preview">
          <h2 class="card-title" id="set-preview">Email preview</h2>
          ${emailPreview(notifyOn)}
        </section>
      </div>
      <p class="hint">Settings live in <a href="${esc(repoUrl('/blob/main/config/settings.json'))}" target="_blank" rel="noopener noreferrer"><code>config/settings.json</code></a>.</p>`;
  }

  function emailPreview(notifyOn) {
    const { lastScan, events, listings } = state.data;
    const wanted = new Set(Object.entries(NOTIFY_KEYS).filter(([k]) => notifyOn[k]).map(([, type]) => type));
    const byId = new Map(listings.map((l) => [l.id, l]));
    const latest = events.filter((e) => Math.abs(time(e.at) - time(lastScan)) < 60000 && wanted.has(e.type));
    if (!latest.length) return `<p class="hint">${lastScan ? 'The last check found nothing new, so no email was sent.' : 'The first email arrives after the first check finds something.'}</p>`;

    const counts = {};
    latest.forEach((e) => (counts[e.type] = (counts[e.type] || 0) + 1));
    const parts = [];
    if (counts.new) parts.push(`${counts.new} new`);
    if (counts.price_drop) parts.push(`${counts.price_drop} price drop${counts.price_drop > 1 ? 's' : ''}`);
    if (counts.price_up) parts.push(`${counts.price_up} price increase${counts.price_up > 1 ? 's' : ''}`);
    if (counts.removed) parts.push(`${counts.removed} sold`);

    const rows = latest
      .map((e) => {
        const l = byId.get(e.listingId) || { title: e.title, url: e.url, platform: e.platform };
        const url = safeUrl(l.url);
        const price = e.type === 'price_drop' || e.type === 'price_up' ? `${fmtPrice(e.from)} → ${fmtPrice(e.to)}` : fmtPrice(e.to ?? e.from ?? l.price);
        return `<div class="email-row">
          <span class="what">${esc(EVENT_LABELS[e.type])} · ${esc(PLATFORMS[l.platform]?.long || '')}</span>
          <span>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(l.title)}</a>` : esc(l.title)}</span>
          <span class="price">${esc(price)}</span>
        </div>`;
      })
      .join('');

    return `<div class="email">
      <div class="email-head">
        <span><span class="k">From</span>Bag Tracker</span>
        <span><span class="k">To</span>you</span>
        <span class="email-subject"><span class="k">Subject</span>${esc(parts.join(', '))} · Bag Tracker</span>
      </div>
      <div class="email-body">${rows}</div>
    </div>`;
  }

  /* ---------- Scan now ---------- */

  function openScanSheet() {
    closeSheet({ restoreFocus: false });
    $('#scan-sheet').hidden = false;
    $('#sheet-backdrop').hidden = false;
    document.body.style.overflow = 'hidden';
    $('#scan-sheet .icon-btn').focus();
  }

  function closeScanSheet({ restoreFocus = true } = {}) {
    if ($('#scan-sheet').hidden) return;
    $('#scan-sheet').hidden = true;
    $('#sheet-backdrop').hidden = true;
    document.body.style.overflow = '';
    if (restoreFocus) $('#scan-now').focus();
  }

  // After the user starts the Cowork task, poll for its results for a while.
  function startWatching() {
    state.watchUntil = Date.now() + WATCH_FOR_MS;
    state.watchMark = state.data ? dataMark(state.data) : '';
    clearInterval(state.watchTimer);
    state.watchTimer = setInterval(() => {
      if (Date.now() > state.watchUntil) return stopWatching();
      load();
    }, WATCH_EVERY_MS);
    closeScanSheet({ restoreFocus: false });
    if (state.data) renderHeader();
    showToast('Watching for new results for 15 minutes.');
  }

  function stopWatching() {
    clearInterval(state.watchTimer);
    state.watchTimer = null;
    state.watchUntil = 0;
    if (state.data) renderHeader();
  }

  function resultsArrived() {
    stopWatching();
    const at = [state.data.lastScan, ...state.data.sources.map((s) => s.lastRun)].filter(Boolean).sort().pop();
    const fresh = state.data.events.filter((e) => e.at === at);
    const blocked = state.data.sources.find((s) => s.lastRun === at && s.status === 'blocked');
    if (blocked) return showToast(`${PLATFORMS[blocked.platform]?.long || 'The site'} blocked the check. See Settings.`);
    const counts = {};
    fresh.forEach((e) => (counts[e.type] = (counts[e.type] || 0) + 1));
    const parts = [];
    if (counts.new) parts.push(`${counts.new} new`);
    if (counts.price_drop) parts.push(`${counts.price_drop} price drop${counts.price_drop > 1 ? 's' : ''}`);
    if (counts.price_up) parts.push(`${counts.price_up} price increase${counts.price_up > 1 ? 's' : ''}`);
    if (counts.removed) parts.push(`${counts.removed} sold`);
    showToast(parts.length ? `Updated: ${parts.join(', ')}` : 'Checked just now. Nothing new.');
  }

  let toastTimer;
  function showToast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 6000);
  }

  /* ---------- Tabs ---------- */

  function effectiveTab() {
    return desktop.matches && state.tab === 'changes' ? 'listings' : state.tab;
  }

  function applyTab() {
    const tab = effectiveTab();
    $$('.view').forEach((v) => (v.hidden = v.dataset.view !== tab));
    $$('[data-tab]').forEach((b) => {
      if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    updateChangesBadge();
  }

  function setTab(tab, { scroll = true } = {}) {
    state.tab = TABS.includes(tab) ? tab : 'listings';
    closeSheet({ restoreFocus: false });
    closeScanSheet({ restoreFocus: false });
    applyTab();
    try {
      const hash = state.tab === 'listings' ? '' : '#' + state.tab;
      history.replaceState(null, '', location.pathname + location.search + hash);
    } catch {
      /* history API unavailable in some embedded viewers */
    }
    if (scroll) window.scrollTo(0, 0);
  }

  /* ---------- Live updates ---------- */

  function tick() {
    if (!state.data) return;
    renderHeader();
    $$('time[data-ago]').forEach((t) => (t.textContent = (t.dataset.prefix || '') + ago(t.dataset.ago)));
  }

  /* ---------- Events ---------- */

  function bind() {
    document.addEventListener('click', (e) => {
      const t = e.target;
      const tabBtn = t.closest('[data-tab]');
      if (tabBtn) return setTab(tabBtn.dataset.tab);

      const main = t.closest('.listing-main');
      if (main) {
        const card = main.closest('.listing');
        const id = card.dataset.id;
        const open = !state.open.has(id);
        if (open) state.open.add(id);
        else state.open.delete(id);
        card.classList.toggle('open', open);
        main.setAttribute('aria-expanded', String(open));
        return;
      }

      const chip = t.closest('[data-platform]');
      if (chip) {
        const key = chip.dataset.platform;
        state.platforms = new Set(key ? [key] : []);
        syncFilterControls();
        return renderListingsArea();
      }

      const stat = t.closest('[data-stat]');
      if (stat) {
        const key = stat.dataset.stat;
        const pressed = stat.getAttribute('aria-pressed') === 'true';
        if (pressed) state.statuses = new Set();
        else if (key === 'live') state.statuses = new Set(Object.keys(STATUSES).filter((k) => k !== 'removed'));
        else state.statuses = new Set([key]);
        syncFilterControls();
        return renderListingsArea();
      }

      if (t.closest('[data-clear-filters]')) return clearFilters();
      if (t.closest('#open-filters')) return openSheet();
      if (t.closest('[data-scan-now]')) return openScanSheet();
      if (t.closest('#watch-start')) return startWatching();
      if (t.closest('#open-claude')) {
        startWatching();
        return;
      }
      if (t.closest('[data-close-scan]')) return closeScanSheet();
      if (t.closest('#sheet-backdrop')) return $('#scan-sheet').hidden ? closeSheet() : closeScanSheet();
      if (t.closest('[data-close-sheet]')) return closeSheet();
      if (t.closest('#reload')) return load();

      const layoutBtn = t.closest('[data-layout]');
      if (layoutBtn) {
        state.layout = layoutBtn.dataset.layout;
        store.set('layout', state.layout);
        return renderListingsArea();
      }

      const goto = t.closest('[data-goto]');
      if (goto) return goToListing(goto.dataset.goto);

      const showQuery = t.closest('[data-show-query]');
      if (showQuery) {
        clearFilters();
        state.query = showQuery.dataset.showQuery;
        syncFilterControls();
        setTab('listings');
        return renderListingsArea();
      }
    });

    $('#filters').addEventListener('change', (e) => {
      const t = e.target;
      if (t.name === 'platform') state.platforms = setFromChecks('platform', activePlatforms().map(([k]) => k));
      else if (t.name === 'status') state.statuses = setFromChecks('status', Object.keys(STATUSES));
      else if (t.id === 'f-query') state.query = t.value;
      else if (t.id === 'f-sort') {
        state.sort = SORTS[t.value] ? t.value : 'newest';
        store.set('sort', state.sort);
      } else return;
      renderListingsArea();
    });

    $('#filters').addEventListener('input', (e) => {
      const t = e.target;
      if (t.id !== 'f-min' && t.id !== 'f-max') return;
      const value = t.value.trim() === '' ? null : Math.max(0, Number(t.value));
      state[t.id === 'f-min' ? 'minPrice' : 'maxPrice'] = Number.isFinite(value) ? value : null;
      renderListingsArea();
    });

    let searchTimer;
    $('#search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.search = e.target.value.trim();
        renderListingsArea();
      }, 120);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#scan-sheet').hidden) closeScanSheet();
      else if ($('#filters').classList.contains('open')) closeSheet();
    });

    // Broken photo links fall back to the bag placeholder underneath.
    document.addEventListener(
      'error',
      (e) => {
        if (e.target instanceof HTMLImageElement && e.target.closest('.thumb')) e.target.remove();
      },
      true
    );

    desktop.addEventListener('change', () => {
      closeSheet({ restoreFocus: false });
      applyTab();
      renderListingsArea();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - (state.loadedAt || 0) > RELOAD_EVERY_MS) load();
    });
  }

  /* ---------- Start ---------- */

  const initial = location.hash.slice(1);
  if (TABS.includes(initial)) state.tab = initial;
  bind();
  applyTab();
  load();
  setInterval(load, RELOAD_EVERY_MS);
  setInterval(tick, TICK_MS);
})();
