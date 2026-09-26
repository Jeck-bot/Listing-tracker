# Inbox file format

Claude (the Cowork task) saves one JSON file per scan to `scanner/inbox/`, named
`cowork-YYYYMMDD-HHMM.json` (UTC time). Saving it on `main` starts the
**Process scan results** workflow, which checks every field, keeps only
listings that match `config/watchlist.json`, updates `data/listings.json` and
emails the changes. The file is deleted afterwards. Files that aren't valid
JSON are moved to `scanner/rejected/`.

## Example

```json
{
  "source": "cowork",
  "runAt": "2026-09-26T02:05:00Z",
  "platform": "carousell",
  "status": "ok",
  "complete": true,
  "message": "",
  "searches": [
    { "term": "balenciaga city", "results": 10 },
    { "term": "chloe paddington", "results": 8 }
  ],
  "listings": [
    {
      "url": "https://www.carousell.ph/p/balenciaga-classic-city-black-1234567890/",
      "title": "Balenciaga Classic City Black",
      "price": 38000,
      "condition": "Lightly used",
      "seller": "closetbyjen",
      "location": "Makati",
      "image": "https://media.karousell.com/media/photos/products/2026/9/26/example.jpg",
      "posted": "3 hours ago",
      "searchTerm": "balenciaga city"
    }
  ],
  "checks": [
    { "url": "https://www.carousell.ph/p/chloe-paddington-bag-1111111111/", "state": "sold" }
  ]
}
```

## Fields

| Field | Required | Notes |
|---|---|---|
| `source` | yes | `"cowork"`. Use `"test"` for a file that should only prove the pipeline works (it changes nothing). |
| `runAt` | yes | When the search ran, ISO time in UTC. |
| `platform` | yes | `"carousell"` for now. `"fb_marketplace"` and `"fb_group"` are reserved for later. |
| `status` | yes | `"ok"`, `"partial"` (some searches failed) or `"blocked"` (bot check, CAPTCHA or login wall; listings are ignored). |
| `complete` | no | `true` when every search term was searched. |
| `message` | no | Short note, shown on the dashboard's Settings tab. |
| `searches` | no | Each search term and how many results were read. |
| `listings[]` | yes | Everything seen in the results, unfiltered. The script decides what matches. |
| `listings[].url` | yes | The listing's own page, `https://www.carousell.ph/p/<title>-<number>/`. A relative `/p/...` link is fine. Search pages, profiles and other sites are rejected, so the dashboard and emails always open the listing itself. Tracking parameters are removed. |
| `listings[].title` | yes | Exactly as shown. |
| `listings[].price` | yes | Pesos as a number (`38000`). Strings like `"PHP 38,000"` are also accepted. |
| `listings[].condition`, `seller`, `location` | no | As shown on the card. |
| `listings[].image` | no | `https://` photo link. |
| `listings[].posted` | no | Text like `"3 hours ago"` or `"yesterday"`. |
| `listings[].searchTerm` | no | Which search found it. |
| `checks[]` | no | Up to 20 tracked listings that didn't appear in the results and were opened directly. `state` is `"sold"`, `"gone"` (deleted or unavailable), `"reserved"` or `"available"`. Only `sold` and `gone` mark a listing as sold/removed. |

Limits: up to 300 listings and 20 checks per file. Titles are cut to 200
characters and descriptions to 1,000.
