# Cowork scheduled task: Bag Tracker scan

Carousell blocks cloud servers with a bot check, so Carousell is searched by
**Claude in the Claude desktop app's browser**, the same way you'd browse it.
A Claude Cowork scheduled task does this every 4 hours:

1. Reads the watchlist from this repo.
2. Searches Carousell for each search term, newest first.
3. Saves what it saw to `scanner/inbox/` in this repo ([format](../scanner/INBOX.md)).
4. That starts the **Process scan results** workflow on GitHub, which updates the
   dashboard and emails you the changes.

It only works while **your computer is on with the Claude desktop app open**,
because that's where the browser runs. If the computer is asleep, that run is
skipped and the dashboard shows the last check as overdue.

## One-time setup

1. On your computer, install and open the **Claude desktop app** and sign in.
2. Make sure Claude can use a browser: the app's built-in browser, or your own
   Chrome through Claude in Chrome. Open https://www.carousell.ph once in it to
   check it loads normally.
3. Make sure **GitHub** is connected (claude.ai → Settings → Connectors), with
   access to `Jeck-bot/Listing-tracker`.
4. Create the task, on your phone or computer:
   - Open **Cowork**, type `/schedule`, and say: *"every 4 hours, run the prompt
     below"*. Or choose **Set up manually**, name it **Bag Tracker scan**, and
     paste the prompt.
   - If only preset schedules are offered, pick **Hourly** and add the extra
     line from [Hourly schedule](#hourly-schedule) below, so most runs stop
     right away.
5. Tap **Run now** once and stay with it. Approve the browser and GitHub actions
   it asks about, choosing *always allow* where offered, so later runs don't
   stall waiting for you.
6. Check it worked:
   - The repo's **Actions** tab shows a **Process scan results** run.
   - A minute later the dashboard shows listings and "Checked … ago".

## "Scan now"

The dashboard's **Scan now** button can't start Cowork by itself. To scan right
away, open the Claude app → **Cowork** → **Scheduled** → **Bag Tracker scan** →
**Run now**. The dashboard refreshes itself when the results arrive.

## The prompt

Copy everything in the box:

```text
Bag Tracker scan (Carousell Philippines)

You keep my Bag Tracker dashboard up to date. The project is the public GitHub repo Jeck-bot/Listing-tracker (branch main). Stay read-only on Carousell: never log in, message sellers, make offers, like, follow or buy anything.

1. Read the current state.
   - Open https://raw.githubusercontent.com/Jeck-bot/Listing-tracker/main/data/listings.json
   - Open https://raw.githubusercontent.com/Jeck-bot/Listing-tracker/main/config/watchlist.json and collect every search term from items[].searchTerms, exactly as written.
   - Open https://raw.githubusercontent.com/Jeck-bot/Listing-tracker/main/config/settings.json and note platforms.carousell.resultsPerSearch (default 10).

2. Search Carousell with the browser, one term at a time.
   - Open https://www.carousell.ph/search/<term with spaces as %20> and make sure the results are sorted by Recent (newest first); use the page's sort control if needed.
   - Read the first <resultsPerSearch> listing cards. For each one record: the card's own listing link, which looks like https://www.carousell.ph/p/<title>-<number>/ (never the search page address; if the page only shows "/p/...", write that), the title exactly as shown, the price in pesos as a plain number, condition, seller username, the photo link if you can see it, and the posted time text (for example "3 hours ago"). Also record which search term found it.
   - Record every listing you see. Don't filter or judge them; the project's script decides what matches.
   - Wait a few seconds between searches.
   - If Carousell shows a bot check ("Just a moment", "Verify you are human"), a CAPTCHA or a login wall, don't try to get past it. Stop searching and go to step 4 with status "blocked" and a short message saying what you saw.

3. Check tracked listings that didn't show up.
   - From the listings.json you opened in step 1, take listings with "platform": "carousell" whose "status" isn't "removed" and whose link didn't appear in today's results.
   - Open up to 5 of them, oldest "lastSeen" first. Record state "sold" if the page says sold, "gone" if it's deleted, unavailable or not found, "reserved" if it says reserved, otherwise "available".

4. Save the results.
   - Build one JSON object in the format described at https://github.com/Jeck-bot/Listing-tracker/blob/main/scanner/INBOX.md with "source": "cowork", "platform": "carousell", "runAt" (current UTC time), "status" ("ok", "partial" or "blocked"), "complete": true if every term was searched, "searches", "listings" and "checks".
   - Save it in the repo Jeck-bot/Listing-tracker on branch main as scanner/inbox/cowork-<UTC time as YYYYMMDD-HHMM>.json with the commit message "Cowork scan results". Commit straight to main; don't open a pull request.
   - Use your GitHub connector if it can create files. If it can't, use the browser: open https://github.com/Jeck-bot/Listing-tracker/new/main/scanner/inbox , type the file name, paste the JSON and choose "Commit directly to the main branch".
   - Saving the file starts the GitHub workflow that updates the dashboard and emails me.

5. Reply with a short summary.
   - How many listings each search showed.
   - Which links weren't already in listings.json (likely new), with title and price.
   - Anything that was blocked or failed.
   - The dashboard link: https://jeck-bot.github.io/Listing-tracker/
   - If listings.json has "notify": {"configured": false} (GitHub email isn't set up yet), there are likely-new listings, and you can send email through my Gmail connector, also email me that summary with the subject "Bag Tracker: new listings".
```

## Hourly schedule

Only needed if Cowork won't let you pick "every 4 hours". Choose **Hourly** and
add this line at the start of step 1 of the prompt:

```text
   - If "lastScan" in listings.json is less than 3 hours ago, reply "Not due yet" with the lastScan time and stop.
```

With this line, a **Run now** within 3 hours of the last check also stops. To
check sooner, remove the line, run it, then put it back.

## Troubleshooting

| What you see | What to do |
|---|---|
| Summary says "blocked" | Open Carousell in the same browser yourself and complete any check it shows, then Run now again. If it keeps happening, scan less often. |
| No **Process scan results** run appears | Claude couldn't save the file. Open the task's last run to see why. Usually the GitHub connector lacks write access; approve it or let it use the browser route in step 4. |
| Runs are skipped | The computer was asleep or the Claude app was closed. Turn on *Keep computer awake* in the desktop app's settings if you want it to run overnight. |
| Dashboard says the last check is overdue | Same as above: the task hasn't run in over 4 hours. |
| A listing is missing | Check its title against the rules in `config/watchlist.json`. Titles with "WTB", "class A", "replica" and so on are skipped on purpose. |

Each run uses some of your Claude plan's usage. Every 4 hours keeps it light.
