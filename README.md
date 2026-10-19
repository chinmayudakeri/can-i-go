# Can I Go?

Find student opportunities (hackathons, conferences, workshops…) and check whether you can actually go: eligibility, deadlines, costs and fit, each explained in plain language.

**Stage 1** runs entirely in the browser on fictional demo data. There's no calendar, AI, or backend yet. Every card says "Calendar not checked yet".

## Requirements

- [Node.js](https://nodejs.org/) 20.9 or newer (`node -v` to check)
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

With the Vitest extension installed, you can also run or debug single tests from the **Testing** sidebar (the flask icon).

## How it's organized

```
data/demo.json          11 fictional events, including edge cases
src/lib/                Pure logic, no React. All tested.
  types.ts              Opportunity, StudentProfile
  eligibility.ts        Per-requirement checks → Matches / Does not match / Needs confirmation
  deadline.ts           Open / passed / unknown / uncertain (cutoff time unknown)
  costs.ts              Cost lines; a total only when nothing is missing
  relevance.ts          Plain-language reasons for/against (no hidden score)
  feed.ts               Search, filters, sorting
  feedParams.ts         Filters ⇄ URL query string
  profileStorage.ts     localStorage read/write/delete
  validate.ts           Runtime check of source data
src/sources/            Data source layer
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

### Adding a real data source

The UI only talks to the `OpportunitySource` interface (`src/sources/types.ts`):

```ts
interface OpportunitySource {
  readonly name: string;
  getOpportunities(): Promise<Opportunity[]>;
}
```

To add one, implement the interface (pass results through `parseOpportunities` from `src/lib/validate.ts`) and add it to the list in `src/sources/index.ts`. `CombinedSource` merges all sources, and later ones win on duplicate ids. No UI changes are needed.

### Profile privacy

The profile is stored only in your browser's localStorage under `can-i-go.profile.v1`. **Delete saved profile** on the Profile page removes it.
