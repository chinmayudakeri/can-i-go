# Can I Go?

Find student opportunities (hackathons, conferences, workshops…) and check whether you can actually go: eligibility, deadlines, costs and fit, each explained in plain language.

**Stage 1** runs entirely in the browser on fictional demo data. Every card says "Calendar not checked yet".

**Stage 2** adds a local ingestion pipeline for real events: `npm run ingest` finds and extracts events, deterministic code keeps only facts quoted verbatim from the source, and nothing reaches the app until you approve it with `npm run review`. There's no database, no accounts, and no paid service; the only AI involved is the Gemini free tier, run from your terminal, never from the web app.

**Stage 3, pass 1** adds calendar import and an attendance check, as pure, tested logic with no UI yet. It reads `.ics` files in the browser, records which dates each calendar covers, and checks an event against your calendar and commitments. See [Stage 3](#stage-3-calendar-and-attendance-check-pass-1).

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
  zonedTime.ts          Wall clock ⇄ UTC in any IANA zone (DST-aware)
  calendar/             .ics import, coverage, manual commitments, localStorage (Stage 3)
  feasibility/          Attendance check: conflicts, warnings, missing info (Stage 3)
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
3. Optional: set `GEMINI_MODEL` if the default (`gemini-3.8-flash`) is retired. Check the [model list](https://ai.google.dev/gemini-api/docs/models).

The free tier may use what you send to improve Google's products. Only public event page text is sent.

### Workflow

```sh
npm run ingest                         # every feed in data/real/feeds.json
npm run ingest -- --url https://…      # one event page
npm run ingest -- --max-calls 5        # lower the AI call cap (default 20)
npm run ingest -- --dry-run            # show what would happen, write nothing
npm run ingest -- --show-rejected      # print every field of rejected records: value, quote, basis, why
npm run ingest -- --force              # re-extract pages recorded as rejected, even if unchanged (still capped)
npm run review                         # approve (a), reject (r), skip (s), quit (q)
```

`npm run review` shows each field next to the quote that supports it, plus everything that was discarded and why. For a record flagged *needs reviewer timezone*, approving asks for the IANA zone and how you verified it; a bad zone or empty note keeps you on that record. Approved events go to `data/real/listings.json` and appear in the app under **Real listings**, with their source and last-verified date. Demo events stay in their own **Demo (fictional)** section, labelled DEMO.

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

- **Evidence rule, in code.** The model proposes each field with a quote and marks it *stated* or *inferred*. A value is kept only if its quote is **one contiguous fragment**, verbatim within a single line of the fetched text, and a deterministic check confirms the value matches the quote (day and month for dates, amount and an explicit currency for money, exact names for programs). A quote stitched across lines or elements is discarded. Dates, deadline, eligibility, cost and support must be *stated*; anything else becomes `null` ("Unknown"). An "open to all" claim needs explicit wording such as "open to all students". A bare `$` is not a currency.
- **Dates.** The day and month must be in the date's own quote. The time of day may come from a separate verified fragment (`timeQuote`), for pages that show the date and time in different elements; both quotes are kept as evidence. The start quote must state the year. The end date may take its year from the verified start quote, and the deadline from the verified start or end quote. A time no quote states is dropped, keeping the date only.
- **Location.** The quote must contain the venue or the city verbatim. Region and country are kept only if that same quote states them. Country is never derived (not from the city, not from the province); when it's missing, review and cards say "Country not stated".
- **Timezone, decided in code.** The model is never asked for a timezone. It's derived from the verified location using a small explicit table in `src/ingest/timezones.ts` (Canadian provinces and major cities → IANA zones), and review shows it as *derived from stated location*. A city counts only with its province or "Canada" stated, so "London" alone or "Vancouver, WA" don't match. A province alone is enough only if it's all on one zone (AB, MB, NB, NS, NT, PE, YT). For ON, QC, BC, NL, NU and SK, the city must be in the table. Anything else leaves the timezone missing (see the next point).
- **Reviewer-confirmed timezone (the one exception).** If the timezone is the *only* required fact missing, for example a page that says just "Toronto" or an online event, the record isn't rejected. It goes to pending flagged **needs reviewer timezone**, holding its verified local times and no zone. `npm run review` won't approve it until you type a real IANA zone (checked against the runtime's IANA list, so "EST" or "Toronto" are refused) and a short note or URL saying how you verified it, such as the venue's official site. The listing stores the zone with basis *confirmed by reviewer*, your note and the date, and the detail page shows **Timezone confirmed by reviewer**. Nothing fills this in automatically: not the AI, not the page, not an earlier listing. If any other required fact is missing too, the record is rejected as before.
- **Official URL.** Always the fetched page's URL, set in code.
- **Required facts.** No name, type, format, timezone, start, end (or location for in-person events) means no listing. `--show-rejected` prints why; `--force` retries after a page or the rules change.
- **Untrusted text.** HTML is stripped (scripts, comments, invisible characters). The model has no tools, and its output is parsed into a fixed schema. Unknown keys are ignored, and ids, sources and dates are set by code. Page text can't change which URLs are fetched, the call cap, or where records go: always to pending, never straight to the app.
- **Safe fetching.** Only public `http(s)` URLs, with no credentials or custom ports. Private, loopback, link-local and metadata addresses are refused, both before the request and at connect time (so DNS rebinding doesn't work), and every redirect is re-checked. Requests are capped at 15 s and 2 MB, with 1 request per second per site.
- **Cost control.** Each page's text is hashed, so an unchanged page makes no AI call, and an unchanged approved page just gets its `lastVerified` date bumped. Each run makes at most 20 calls by default, retries included. Only network timeouts and HTTP 429, 503 and 504 are retried, with exponential backoff. Anything else (bad request, other network errors, unexpected response shape, unparseable output) fails at once with its underlying cause. Response-shape errors list the HTTP status and the response's keys, never its content. An invalid key or model stops the run on the first error.
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

## Stage 3: calendar and attendance check (pass 1)

Pass 1 is logic only (`src/lib/calendar`, `src/lib/feasibility`), with tests. The UI comes in a later pass.

### Privacy

Calendar files are parsed in the browser, and the results are stored only in its localStorage (`can-i-go.calendar.v1` for imports, `can-i-go.commitments.v1` for commitments you enter). `deleteCalendarData` removes both. None of this code makes network requests or imports `src/ingest`, and `src/lib/calendar/privacy.test.ts` enforces that.

### Reading .ics files

We use [ical.js](https://github.com/kewisch/ical.js) (2.2.1). It is maintained by the Mozilla Thunderbird calendar team, has no dependencies, runs in the browser, ships TypeScript types, and implements RFC 5545 recurrence (RRULE, RDATE, EXDATE, RECURRENCE-ID) and VTIMEZONE. Hand-rolling recurrence is where calendar bugs live, so we don't.

- **Times.** A TZID with a VTIMEZONE in the file uses that definition. A standard IANA TZID without one (common in exports) is converted with the browser's own timezone data. UTC stays UTC. Floating times (no zone) are read in your timezone, and the report says so. An unknown zone name is reported and the event is skipped.
- **Recurring events** are expanded from about a month ago to 400 days ahead. EXDATEs are removed, and moved occurrences (RECURRENCE-ID) appear at their new time. A repeat with no end date is included up to that limit, with a warning. EXRULE isn't supported, so those dates stay busy, with a warning.
- **Status.** Cancelled events and cancelled occurrences are skipped and counted. Tentative events still block time and are labelled tentative. `TRANSP:TRANSPARENT` ("show as free") events are kept but never block time.
- **All-day events** run from local midnight to midnight. A busy all-day event blocks the whole day, and the explanation says "marked busy all day".
- **Duplicates.** Each occurrence has a stable key, UID + RECURRENCE-ID + start. Importing the same file again, or the same event from two calendars, adds nothing new. Re-importing a calendar under the same id replaces its events.
- **Import report.** Every import returns errors (an event couldn't be read: bad date, unknown zone, no start, ends before it starts) and warnings (floating times, to-dos and journals ignored, missing UIDs, open-ended repeats, events outside the window). Nothing is dropped silently.
- **Limits.** Files over 2 MB, or calendars with more than 10,000 events in the window, are rejected with a message that suggests exporting less. Text that isn't iCalendar is rejected.

### Coverage

Each import records the dates it actually covers: from its earliest event to its latest, in your timezone, plus an optional note from you (e.g. "Fall term classes only"). An empty calendar covers nothing. If any date the event needs, including travel days, isn't inside some calendar's coverage, the result is **calendar coverage incomplete**, never "free". Manual commitments don't add coverage.

### Manual commitments

Kinds are `class`, `exam`, `work` and `personal` (each with a start and an end), and `assignment`, which has only a `due` time: it's a deadline, not a block of occupied time.

### The attendance check

`checkFeasibility` in `src/lib/feasibility` is a pure function. It takes the event, your commitments (imported and manual), coverage, your shortlist, and assumptions: the one-way travel minutes you entered, an arrival buffer, exam preparation days, an assignment warning window, how you'll attend a hybrid event, and your timezone. There are no maps or travel APIs. It returns:

- **Hard conflicts.** Overlap with a required session (or the whole event if no schedule is published), travel there or home, an exam inside your preparation buffer, an overlapping shortlisted event, a passed application deadline, or an event that has already ended.
- **Soft warnings.** Assignments due within the warning window, optional sessions you'd miss, commitments in a break between sessions (breaks aren't required, but you may be away), and a same-day deadline with an unknown cutoff.
- **Missing information**, flagged as blocking or not: travel time not entered, location unknown (travel is *Needs confirmation*, never zero), dates no calendar covers, event hours unknown, a session that doesn't say whether it's required, unreadable calendar events, and an unpublished deadline.

Each item names the exact commitment and times in plain language. The status is `conflicts`, `calendar coverage incomplete`, `needs confirmation` or `no conflicts found`, in that order of priority.

Rules it follows:

- Intervals are half-open, so a shift ending at 9:00 doesn't clash with a 9:00 start, but it does once travel or an arrival buffer is needed.
- **Sessions.** Opportunities may carry `attendanceSessions` (start, end, label, mandatory). `mandatory: null` is treated as required and listed as missing information. Outbound travel is timed to the first required session and the trip home to the last.
- **Unknown hours.** An event stored as 00:00:00 to 23:59:59 local (how ingestion stores a date with no stated time) gets a conservative all-day window, and the explanation says so.
- **Exam buffer.** An exam starting less than *N* × 24 hours after the event ends is a hard conflict. Exactly *N* days after is fine.

### Profile privacy

The profile is stored only in your browser's localStorage under `can-i-go.profile.v1`. **Delete saved profile** on the Profile page removes it.
