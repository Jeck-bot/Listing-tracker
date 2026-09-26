/*
 * Carousell reachability check. Prints what a plain request and a real browser
 * get back for one search, so the scanner can use the approach that works.
 * Usage: node scanner/diagnose.mjs "chloe paddington" [--browser]
 */
const term = process.argv[2] || 'chloe paddington';
const useBrowser = process.argv.includes('--browser');
const url = `https://www.carousell.ph/search/${encodeURIComponent(term)}?sort_by=3`;

const MARKERS = ['Just a moment', 'cf-chl', 'challenge-platform', '__NEXT_DATA__', 'initialState', '__APOLLO_STATE__', 'application/ld+json', 'listingCard', 'listing-card', '"price"', 'priceFormatted'];

function report(label, html) {
  console.log(`\n== ${label}: ${html.length} chars`);
  for (const m of MARKERS) {
    const i = html.indexOf(m);
    if (i >= 0) console.log(`marker ${JSON.stringify(m)} at ${i}`);
  }
  const links = [...new Set(html.match(/\/p\/[a-z0-9-]+-\d{6,}/gi) || [])];
  console.log(`listing links: ${links.length}`, links.slice(0, 5));
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
    .map((m) => ({ attrs: m[1].trim().slice(0, 120), size: m[2].length, head: m[2].trim().slice(0, 160).replace(/\s+/g, ' ') }))
    .filter((s) => s.size > 2000)
    .sort((a, b) => b.size - a.size)
    .slice(0, 6);
  console.log('largest inline scripts:');
  for (const s of scripts) console.log(`  [${s.size}] <script ${s.attrs}> ${s.head}`);
  if (links[0]) {
    const at = html.indexOf(links[0]);
    console.log('context around first link:\n', html.slice(Math.max(0, at - 600), at + 400).replace(/\s+/g, ' '));
  }
}

async function plain() {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'en-PH,en;q=0.9',
    },
    redirect: 'follow',
  });
  console.log(`plain GET ${url} -> ${res.status} ${res.headers.get('content-type')}`);
  for (const h of ['server', 'cf-ray', 'cf-mitigated', 'set-cookie', 'location']) {
    const v = res.headers.get(h);
    if (v) console.log(`  ${h}: ${v.slice(0, 160)}`);
  }
  report('plain HTML', await res.text());
}

async function browser() {
  const { chromium } = await import('playwright');
  const b = await chromium.launch();
  const page = await b.newPage({ locale: 'en-PH' });
  const apis = [];
  page.on('response', async (r) => {
    const ct = r.headers()['content-type'] || '';
    if (ct.includes('json') && /carousell/.test(r.url())) {
      let body = '';
      try { body = await r.text(); } catch { /* ignore */ }
      apis.push({ url: r.url(), status: r.status(), method: r.request().method(), size: body.length, head: body.slice(0, 600) });
    }
  });
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  console.log(`\nbrowser goto -> ${resp && resp.status()}`);
  await page.waitForTimeout(8000);
  console.log('title:', await page.title());
  const cards = await page.$$eval('a[href*="/p/"]', (as) => as.slice(0, 8).map((a) => ({ href: a.getAttribute('href'), text: a.innerText.replace(/\s+/g, ' ').slice(0, 160) })));
  console.log('card links:', JSON.stringify(cards, null, 1));
  report('browser HTML', await page.content());
  console.log(`\njson responses: ${apis.length}`);
  for (const a of apis.sort((x, y) => y.size - x.size).slice(0, 6)) {
    console.log(`- ${a.method} ${a.status} ${a.url.slice(0, 200)} [${a.size}]\n  ${a.head.replace(/\s+/g, ' ')}`);
  }
  const post = apis.find((a) => a.method === 'POST' && a.size > 1000);
  if (post) console.log('\nlargest POST request found; see above');
  await b.close();
}

try {
  await plain();
} catch (e) {
  console.log('plain request failed:', e.message);
}
if (useBrowser) {
  try {
    await browser();
  } catch (e) {
    console.log('browser check failed:', e.message);
  }
}
