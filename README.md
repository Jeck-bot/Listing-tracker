# Listing-tracker

A dashboard that tracks **Balenciaga City**, **Chloe Paddington bags** and
**Chloe Paddington lock and key** listings on **Carousell Philippines**. It shows
new listings, price drops and increases, and sold items, with a link straight to
each listing, and can email you when something changes.

**Dashboard:** https://jeck-bot.github.io/Listing-tracker/ (after GitHub Pages is
turned on; see *Setup*).

| Phone | Desktop |
| --- | --- |
| <img src="docs/screenshots/phone.png" width="260" alt="Dashboard on a phone"> | <img src="docs/screenshots/desktop.png" width="560" alt="Dashboard on a desktop"> |

## How it works

```
Claude Cowork task (every 4 h, on your computer's Claude app)
  └─ searches Carousell in the browser for each search term
  └─ saves what it saw → scanner/inbox/cowork-<time>.json
        └─ GitHub Actions "Process scan results" (starts automatically)
             ├─ keeps listings whose titles match config/watchlist.json
             ├─ works out new / price drop / price up / sold
             ├─ saves data/listings.json → the dashboard updates
             └─ emails the changes (once Gmail secrets are set)
```

Carousell shows cloud servers a bot check, so the searching is done by Claude in
the Claude desktop app's browser, like a normal visitor. That means **checks run
while your computer is on with the Claude app open**. The dashboard warns you
when a check is overdue.

**Scan now:** the button on the dashboard shows how to start the Cowork task
right away (Claude app → Cowork → Scheduled → Bag Tracker scan → **Run now**),
then watches for the results and refreshes itself.

## What's tracked

Edit `config/watchlist.json` to change any of this.

| Item | Carousell searches | Counts when the title has |
|---|---|---|
| Chloe Paddington lock and key | chloe paddington lock, chloe padlock, chloe lock and key | chloe + lock/padlock, and no bag words (unless it says "lock only", "no bag"…) |
| Chloe Paddington bag | chloe paddington | chloe + paddington |
| Balenciaga City | balenciaga city, balen city, bal city | balenciaga/balen/bal + city (place names like "Quezon City" don't count) |

Titles with **WTB, LF, ISO, looking for, class A, replica, mirror quality,
inspired, OEM, 1:1** are skipped (buy requests and fakes). Matching ignores
accents, so "Chloé" counts as "chloe".

## Setup

1. **GitHub Pages** (once): repo **Settings → Pages → Build and deployment →
   Deploy from a branch → `main` / `(root)` → Save**. The dashboard appears at
   the link above within a minute or two.
2. **Cowork task**: follow [docs/cowork-task.md](docs/cowork-task.md). It has a
   copy-paste prompt, schedule settings and troubleshooting.
3. **Email alerts** (when your dedicated Gmail is ready):
   1. On that Gmail account, turn on 2-Step Verification, then create an
      **App password** (Google Account → Security → App passwords).
   2. In this repo: **Settings → Secrets and variables → Actions → New
      repository secret**, and add:
      - `GMAIL_USER`: the Gmail address that sends the alerts
      - `GMAIL_APP_PASSWORD`: the 16-character app password
      - `NOTIFY_TO`: where alerts go (can be the same address)
   3. Choose which changes email you in `config/settings.json` → `notifyOn`.

The repo is public, so the email address and password only ever live in GitHub
Secrets, never in the files.

## Folder guide

```
index.html, assets/          the dashboard (plain HTML/CSS/JS, no build step)
config/watchlist.json        items, search terms and matching rules      ← you edit
config/settings.json         check interval, which changes email you     ← you edit
data/listings.json           current listings + change history           ← written by the workflow
scanner/inbox/               where Claude drops each scan's results
scanner/INBOX.md             the format of those files
scanner/run.js               processes the inbox (npm run process)
scanner/lib/                 matching, merging, validation, email
scanner/test/                unit tests (npm test)
.github/workflows/scan.yml   runs run.js when a results file arrives
.github/workflows/ci.yml     runs the tests on every change
docs/cowork-task.md          Cowork task setup and prompt
```

## For developers

```bash
npm ci
npm test                  # unit tests
npm run process           # process scanner/inbox/ locally
node scanner/run.js --dry-run
python3 -m http.server    # then open http://localhost:8000
```

## Later

Facebook Marketplace and groups can plug into the same inbox format (the Cowork
task searching them in your logged-in browser). They're switched off in
`config/settings.json` for now.
