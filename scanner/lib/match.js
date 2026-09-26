/*
 * Decides which watchlist item (if any) a listing belongs to.
 * Matching is on normalized text: lowercase, accents removed, whole words only.
 */

const phraseCache = new Map();

export function normalize(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[^a-z0-9:&'\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function phraseRegex(phrase, flags = '') {
  const key = `${flags}|${phrase}`;
  if (!phraseCache.has(key)) {
    const body = normalize(phrase)
      .split(' ')
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+');
    phraseCache.set(key, new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, flags));
  }
  return phraseCache.get(key);
}

export function hasPhrase(text, phrase) {
  return phraseRegex(phrase).test(text);
}

function removePhrases(text, phrases = []) {
  return phrases.reduce((t, p) => t.replace(phraseRegex(p, 'g'), ' '), text);
}

/** spec: { all: [[any-of], ...], none: [...], unless: [...], ignore: [...] } */
export function matchesSpec(normalizedText, spec = {}) {
  const text = removePhrases(normalizedText, spec.ignore);
  const all = spec.all || [];
  if (!all.every((group) => group.some((p) => hasPhrase(text, p)))) return false;
  const blocked = (spec.none || []).some((p) => hasPhrase(text, p));
  if (blocked && !(spec.unless || []).some((p) => hasPhrase(text, p))) return false;
  return true;
}

function inPriceRange(item, price) {
  if (typeof price !== 'number') return true;
  if (typeof item.minPrice === 'number' && price < item.minPrice) return false;
  if (typeof item.maxPrice === 'number' && price > item.maxPrice) return false;
  return true;
}

/** Returns the first watchlist item the listing title matches, or null. */
export function matchItem(listing, watchlist) {
  const title = normalize(listing.title);
  if (!title) return null;
  if ((watchlist.excludeAny || []).some((p) => hasPhrase(title, p))) return null;
  for (const item of watchlist.items || []) {
    if (matchesSpec(title, item.match) && inPriceRange(item, listing.price)) return item;
  }
  return null;
}
