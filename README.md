# Can I Go?

Find student opportunities (hackathons, conferences, workshops…) and check whether you can actually go: eligibility, deadlines, costs and fit, each explained in plain language.

**Stage 1** runs entirely in the browser on fictional demo data. Every card says "Calendar not checked yet".

**Stage 2** adds a local ingestion pipeline for real events: `npm run ingest` finds and extracts events, deterministic code keeps only facts quoted verbatim from the source, and nothing reaches the app until you approve it with `npm run review`. There's no database, no accounts, and no paid service; the only AI involved is the Gemini free tier, run from your terminal, never from the web app.

## Requirements

- [Node.js](https://nodejs.org/) 20.12 or newer (`node -v` to check)
- [VS Code](https://code.visualstudio.com/)

## Set up in VS Code

1. **File → Open Folder…** and choose this `can-i-go` folder.
2. When VS Code offers to install the recommended extension (**Vitest**), accept it. Or open the Extensions view and search `@recommended`.
3. Open a terminal with **Terminal → New Terminal** (`` Ctrl+` ``) and install dependencies:
   ```sh
   npm install
   ```
4. If VS Code asks whether to use the workspace TypeScript version, choose **Allow**.

## Run

```sh
npm run dev
```

Open http://localhost:3000. Start at **Profile**, fill in a few fields and save. Then go to **Discover** and the cards will show eligibility and reasons for your profile.

| Command             | What it does                          |
| ------------------- | ------------------------------------- |
| `npm run dev`       | Dev server with hot reload            |
| `npm test`          | Run all unit tests once (Vitest)      |
| `npm run test:watch`| Re-run tests on save                  |
| `npm run typecheck` | Type-check without building           |
| `npm run build`     | Production build (`npm start` serves it) |
| `npm run ingest`    | Fetch configured feeds and extract events into `data/real/pending.json` |
| `npm run ingest -- --url <link>` | Extract one event page you choose |
| `npm run review`    | Approve or reject pending events in the terminal |

With the Vitest extension installed, you can also run or debug single tests from the **Testing** sidebar (the flask icon).

## How it's organized

```
data/demo.json          11 fictional events, including edge cases
data/real/              Real listings pipeline (see Stage 2)
  feeds.json            iCal/RSS feeds to ingest (you edit this)
  pending.json          Extracted events waiting for review
  listings.json         Approved events, shown in the app
  state.json            Page hashes and review decisions
src/lib/                Pure logic, no React. All tested.
  types.ts              Opportunity, StudentProfile
  eligibility.ts        Per-requirement checks → Matches / Does not match / Needs confirmation
  deadline.ts           Open / passed / unknown / uncertain (cutoff time unknown)
  costs.ts              Cost lines; a total only when nothing is missing
  relevance.ts          Plain-language reasons for/against (no hidden score)
  feed.ts               Search, filters, sorting
  feedParams.ts         Filters ⇄ URL query string
  profileStorage.ts     localStorage read/write/delete
  validate.ts           Runtime check of source data (stricter "real listing" mode)
src/sources/            Data source layer (DemoSource, RealSource)
src/ingest/             Stage 2 pipeline. Node-only, never imported by the app
scripts/                ingest and review CLIs
src/hooks/              React hooks for loading data and profile
src/components/         UI pieces (cards, badges, cost list…)
src/app/                Pages: / (Discover), /events/[id], /profile
```

### Rules the app follows

- **Unknown stays unknown.** `null` in the data means "not stated by the source". An unknown requirement is always *Needs confirmation*, never a match.
- **Eligibility:** any failed check means *Does not match*. Otherwise any unknown or uncheckable check means *Needs confirmation*. Otherwise *Matches*. Each check on the detail page shows the source requirement and quote.
- **Costs:** each line is listed separately (registration, travel, and lodging for multi-day in-person events). A **Total** appears only when every line is known. Otherwise the card shows "Known so far: $X. Not included: …".
- **Currency:** amounts are in CAD. Amounts in different currencies are never added together or compared with your budget, and any non-CAD amount is shown with its prefix (e.g. `US$25`).
- **Programs:** the profile uses a fixed dropdown (`PROGRAMS` in `src/lib/types.ts`), and event requirements must use the same values, so matching is exact. `Other` against a restricted list is *Needs confirmation*. Source data with an unknown program value is rejected by `validate.ts`.
- **Deadlines:** when only the date is known (`exactCutoffUnknown`), the deadline is stored as the end of that day. It shows as "may already be closed" during its last 24 hours.
- **Relevance:** reasons for and against come from interests, beginner support, format preference, travel, and budget. Sorting by relevance uses *reasons for minus reasons against*, and both counts are shown on the card. Travel time between cities isn't estimated yet, and the app says so instead of guessing.

## Stage 2: real listings

### Set up

1. Get a free Gemini API key at https://aistudio.google.com/apikey.
2. Copy `.env.example` to `.env` and paste the key after `GEMINI_API_KEY=`. `.env` is gitignored; never commit it. The key is only read by `npm run ingest`; the web app never sees it.
3. Optional: set `GEMINI_MODEL` if the default (`gemini-2.5-flash`) is retired. Check the [model list](https://ai.google.dev/gemini-api/docs/models).

The free tier may use what you send to improve Google's products. Only public event page text is sent.

### Workflow

```sh
npm run ingest                         # every feed in data/real/feeds.json
npm run ingest -- --url https://…      # one event page
npm run ingest -- --max-calls 5        # lower the AI call cap (default 20)
npm run ingest -- --dry-run            # show what would happen, write nothing
npm run review                         # approve (a), reject (r), skip (s), quit (q)
```

`npm run review` shows each field next to the quote that supports it, plus everything that was discarded and why. Approved events go to `data/real/listings.json` and appear in the app under **Real listings**, with their source and last-verified date. Demo events stay in their own **Demo (fictional)** section, labelled DEMO.

### Adding feeds

Edit `data/real/feeds.json`:

```json
[
  {
    "name": "Luma Toronto",
    "kind": "ics",
    "url": "https://api.lu.ma/ics/get?entity=discover&id=…",
    "timezone": "America/Toronto",
    "keywords": ["hackathon", "hack"]
  },
  { "name": "Club news", "kind": "rss", "url": "https://club.example/feed.xml" }
]
```

- `kind`: `ics` (iCalendar) or `rss` (RSS or Atom).
- `timezone` (optional): shows UTC feed times in this zone. Without it, times stay in UTC and only the date can be verified.
- `keywords` (optional): only items mentioning one of these words are extracted, which saves calls on busy feeds.
- For a Luma calendar or city page, click **Add iCal Subscription** and copy the URL it gives you.

### Which sources are allowed

Checked on 2026-10-18. These rules are enforced in `src/ingest/policy.ts`, for feeds and `--url` alike.

| Source | robots.txt | Terms of service | What we do |
| --- | --- | --- | --- |
| Devpost | Allows general crawlers | §4 forbids automated access, scraping, crawling or spidering | **Blocked** |
| MLH | Allows most paths | Personal, non-commercial use only; no republishing without written consent | **Blocked** |
| Luma | No rules for general crawlers | "must not access the Service by any means other than our publicly supported interfaces"; the official API needs paid Luma Plus | **iCal subscription feeds only**, no event pages |

For any other site, `robots.txt` is checked automatically before every request (an unreachable robots.txt means we stay out). Terms of service can't be checked automatically, so you're responsible for the sites you add. Prefer each hackathon's own website.

### How the pipeline stays honest

- **Evidence rule, in code.** The model proposes each field with a quote and marks it *stated* or *inferred*. A value is kept only if its quote appears verbatim in the fetched text and a deterministic check confirms the value matches the quote (day and month for dates, amount and an explicit currency for money, exact names for programs). Dates, deadline, eligibility, cost and support must be *stated*; anything else becomes `null` ("Unknown"). An "open to all" claim needs explicit wording such as "open to all students". A bare `$` is not a currency.
- **Required facts.** No name, type, format, timezone, start, end (or location for in-person events) means no listing.
- **Untrusted text.** HTML is stripped (scripts, comments, invisible characters). The model has no tools, and its output is parsed into a fixed schema. Unknown keys are ignored, and ids, sources and dates are set by code. Page text can't change which URLs are fetched, the call cap, or where records go: always to pending, never straight to the app.
- **Safe fetching.** Only public `http(s)` URLs, with no credentials or custom ports. Private, loopback, link-local and metadata addresses are refused, both before the request and at connect time (so DNS rebinding doesn't work), and every redirect is re-checked. Requests are capped at 15 s and 2 MB, with 1 request per second per site.
- **Cost control.** Each page's text is hashed, so an unchanged page makes no AI call, and an unchanged approved page just gets its `lastVerified` date bumped. Each run makes at most 20 calls by default, retries included, and rate limits back off exponentially. An invalid key or model stops the run on the first error.
- **Deduplication.** Same normalized name plus same local start date means the same event. Merging keeps every source URL and the latest verification date.
- **Validation.** Every record is checked against the `Opportunity` type (real dates, end after start, deadline before the end, IANA timezone, ISO currency) before anything is written. Writes are atomic.
- **Known limit.** A page that plainly *states* a false fact will pass the quote check, because it really is on the page. That's why every record needs your approval.

### Adding a data source in code

The UI only talks to the `OpportunitySource` interface (`src/sources/types.ts`):

```ts
interface OpportunitySource {
  readonly name: string;
  getOpportunities(): Promise<Opportunity[]>;
}
```

To add one, implement the interface (pass results through `parseOpportunities` from `src/lib/validate.ts`, and stamp each record with `dataset: "demo"` or `"real"`) and add it to the list in `src/sources/index.ts`. `CombinedSource` merges all sources, and later ones win on duplicate ids. Records not stamped `"real"` are labelled DEMO.

### Profile privacy

The profile is stored only in your browser's localStorage under `can-i-go.profile.v1`. **Delete saved profile** on the Profile page removes it.
