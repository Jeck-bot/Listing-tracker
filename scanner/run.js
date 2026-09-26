#!/usr/bin/env node
/*
 * Processes the results Claude left in scanner/inbox/: matches them to the
 * watchlist, updates data/listings.json and emails any changes.
 * Usage: node scanner/run.js [--dry-run]
 */
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchItem } from './lib/match.js';
import { readInbox, clearInbox } from './lib/inbox.js';
import { emptyData, mergeResults, summarize } from './lib/merge.js';
import { buildEmail, emailConfig, sendEmail } from './lib/notify.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`Could not read ${path.relative(ROOT, file)}: ${err.message}`);
  }
}

function dashboardUrl(settings) {
  const gh = settings.github || {};
  if (settings.dashboardUrl) return settings.dashboardUrl;
  return gh.owner && gh.repo ? `https://${gh.owner.toLowerCase()}.github.io/${gh.repo}/` : '';
}

export async function processInbox({ root = ROOT, now = new Date(), env = process.env, dryRun = false, transport } = {}) {
  const settings = await readJson(path.join(root, 'config/settings.json'));
  const watchlist = await readJson(path.join(root, 'config/watchlist.json'));
  const dataFile = path.join(root, 'data/listings.json');
  const prev = await readJson(dataFile, emptyData());
  const entries = await readInbox(path.join(root, 'scanner/inbox'), { now });
  const log = [];

  for (const e of entries) {
    const name = path.basename(e.file);
    log.push(`${name}: ${e.kind}${e.result ? ` (${e.result.platform}, ${e.result.status}, ${e.result.listings.length} listings)` : ''}`);
    for (const w of e.warnings) log.push(`  warning: ${w}`);
  }

  const enabled = settings.platforms || {};
  const results = entries
    .filter((e) => e.kind === 'results')
    .map((e) => e.result)
    .filter((r) => {
      if (enabled[r.platform]?.enabled === false) {
        log.push(`  skipped ${r.platform}: switched off in config/settings.json`);
        return false;
      }
      return true;
    })
    .map((r) => {
      const listings = [];
      for (const l of r.listings) {
        const item = matchItem(l, watchlist);
        if (item) listings.push({ ...l, itemId: item.id, matchedQuery: item.label });
      }
      log.push(`  ${r.platform}: ${listings.length} of ${r.listings.length} listings match the watchlist`);
      return { ...r, listings };
    });

  const cfg = emailConfig(env);
  const { data, events } = results.length
    ? mergeResults(prev, results, { now, watchlist, intervalHours: settings.scanIntervalHours })
    : { data: prev, events: [] };
  data.notify = { configured: cfg.configured };
  const summary = summarize(events);
  let emailed = { sent: false, reason: 'No changes to email' };

  if (!dryRun && entries.length) {
    await writeFile(dataFile, `${JSON.stringify(data, null, 2)}\n`);
    await clearInbox(entries, path.join(root, 'scanner/rejected'));
    const email = buildEmail(events, { notifyOn: settings.notifyOn || {}, dashboardUrl: dashboardUrl(settings), watchlist });
    if (email) {
      try {
        emailed = await sendEmail(email, cfg, { createTransport: transport });
      } catch (err) {
        emailed = { sent: false, reason: `Email failed: ${err.message}` };
      }
    }
  }

  return { entries: entries.length, results: results.length, events, summary, emailed, log, data };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const out = await processInbox({ dryRun });
  if (!out.entries) {
    console.log('Inbox is empty. Nothing to do.');
  } else {
    out.log.forEach((line) => console.log(line));
    console.log(`Result: ${out.summary}${dryRun ? ' (dry run, nothing saved)' : ''}`);
    console.log(out.emailed.sent ? 'Email sent.' : `Email not sent: ${out.emailed.reason}`);
  }
  const message = out.entries ? `Scan: ${out.summary}` : '';
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `message=${message}\n`);
  if (process.env.GITHUB_STEP_SUMMARY && out.entries) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### ${out.summary}\n\n\`\`\`\n${out.log.join('\n')}\n\`\`\`\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
