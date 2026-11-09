/**
 * Headless browser check of the built app at desktop and phone widths.
 * Drives your installed Google Chrome through playwright-core (no browser
 * download). Uses only fictional fixtures and demo events.
 *
 *   npm run build && npm run ui-check
 *
 * Screenshots go to .ui-check/ (gitignored). Exits non-zero on any failure.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright-core";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = Number(process.env.UI_CHECK_PORT ?? 3123);
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(ROOT, ".ui-check");
const FIXTURES = path.join(ROOT, "src/lib/calendar/fixtures");
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

const failures: string[] = [];
const fail = (where: string, what: string) => failures.push(`[${where}] ${what}`);

async function startServer(): Promise<ChildProcess> {
  if (!existsSync(path.join(ROOT, ".next", "BUILD_ID"))) throw new Error("No production build found. Run `npm run build` first.");
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: ROOT, stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE)).ok) return server;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  server.kill();
  throw new Error(`Server didn't start on ${BASE}`);
}

/** Layout and labelling checks that apply to every page. */
async function checkPage(page: Page, where: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) fail(where, `page scrolls horizontally by ${overflow}px`);

  const unlabelled = await page.evaluate(() => {
    const nameOf = (el: HTMLElement): string => {
      const labelledBy = el.getAttribute("aria-labelledby");
      const byIds = labelledBy ? labelledBy.split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ") : "";
      const labels = "labels" in el ? [...((el as HTMLInputElement).labels ?? [])].map((l) => l.textContent ?? "").join(" ") : "";
      const own = el.tagName === "BUTTON" || el.tagName === "A" ? el.textContent ?? "" : "";
      return [el.getAttribute("aria-label"), byIds, labels, own, el.getAttribute("title")].join(" ").trim();
    };
    return [...document.querySelectorAll<HTMLElement>("input, select, textarea, button, a[href]")]
      .filter((el) => !nameOf(el))
      .map((el) => el.outerHTML.slice(0, 120));
  });
  for (const html of unlabelled) fail(where, `control without an accessible name: ${html}`);

  const smallTargets = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("main button, main select, header nav a")]
      .filter((el) => el.offsetParent !== null)
      .filter((el) => el.getBoundingClientRect().height < 43.5)
      .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}" (${Math.round(el.getBoundingClientRect().height)}px)`),
  );
  for (const t of smallTargets) fail(where, `touch target under 44px: ${t}`);
}

/** Tabs through the start of the page: skip link first, every stop visibly focused. */
async function checkKeyboard(page: Page, where: string): Promise<void> {
  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => document.activeElement?.textContent?.trim());
  if (first !== "Skip to content") fail(where, `first Tab stop is "${first}", not the skip link`);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const visible = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return true;
      const s = getComputedStyle(el);
      return s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2;
    });
    if (!visible) {
      const what = await page.evaluate(() => (document.activeElement as HTMLElement).outerHTML.slice(0, 100));
      fail(where, `no visible focus ring on ${what}`);
      break;
    }
  }
}

async function expectText(page: Page, where: string, text: string | RegExp): Promise<void> {
  try {
    await page.getByText(text).first().waitFor({ timeout: 8000 });
  } catch {
    fail(where, `expected to see ${String(text)}`);
  }
}

async function expectAbsent(page: Page, where: string, text: RegExp): Promise<void> {
  const body = await page.locator("main").innerText();
  const m = text.exec(body);
  if (m) fail(where, `should not show "${m[0]}"`);
}

async function run(viewport: (typeof VIEWPORTS)[number]): Promise<void> {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport, acceptDownloads: true, timezoneId: "America/Toronto", colorScheme: "light", reducedMotion: "reduce" });
  // tsx (esbuild keepNames) wraps functions passed to page.evaluate in a __name() helper the page doesn't have.
  await context.addInitScript("globalThis.__name = (f) => f;");
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  page.on("pageerror", (e) => fail(viewport.name, `page error: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && fail(viewport.name, `console error: ${m.text()} (${m.location().url})`));
  const shot = (name: string) => page.screenshot({ path: path.join(OUT, `${viewport.name}-${name}.png`), fullPage: true });
  const visit = async (route: string, name: string) => {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
    await checkPage(page, `${viewport.name} ${name}`);
  };

  const toggle = page.getByRole("switch", { name: "Use my calendar" });
  const switchIs = async (where: string, on: boolean) => {
    if ((await toggle.getAttribute("aria-checked")) !== String(on)) fail(where, `"Use my calendar" should be ${on ? "on" : "off"}`);
  };
  const navHasCalendar = () => page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Calendar" }).count();

  // 1. A new visitor: the switch is off and nothing mentions attendance.
  await visit("/", "off discover");
  await switchIs(`${viewport.name} off discover`, false);
  if (await navHasCalendar()) fail(`${viewport.name} off discover`, "Calendar link shown while the switch is off");
  await expectAbsent(page, `${viewport.name} off discover`, /attendance|Can you attend|Import a calendar/i);
  await checkKeyboard(page, `${viewport.name} off discover`);
  await shot("off-discover");
  await visit("/profile", "off profile");
  if (await page.getByLabel(/Usual travel time/).count()) fail(`${viewport.name} off profile`, "travel settings shown while off");
  await visit("/events/demo-lakeshore-hacks", "off detail");
  await expectAbsent(page, `${viewport.name} off detail`, /Can you attend\?|attendance feasibility/i);
  await shot("off-detail");

  // 2. Switch on with the keyboard.
  await visit("/", "discover");
  await toggle.focus();
  await page.keyboard.press("Space");
  await switchIs(`${viewport.name} keyboard toggle`, true);
  if (!(await navHasCalendar())) fail(`${viewport.name} on discover`, "Calendar link missing while on");
  await expectText(page, `${viewport.name} discover`, /attendance feasibility has not been checked/i);
  await shot("discover-empty");

  // 3. Profile: travel time assumption.
  await visit("/profile", "profile");
  await page.getByLabel(/Usual travel time/).fill("30");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expectText(page, `${viewport.name} profile`, "Saved.");
  await shot("profile");

  // 4. Calendar: import two fictional calendars and add an exam.
  await visit("/calendar", "calendar");
  await expectText(page, `${viewport.name} calendar`, /No calendar connected/);
  await page.getByLabel(/\.ics files/).setInputFiles([path.join(FIXTURES, "adjacent.ics"), path.join(FIXTURES, "recurring.ics")]);
  await page.getByRole("button", { name: "Import 2 calendars" }).click();
  await expectText(page, `${viewport.name} calendar`, "Import results");
  await expectText(page, `${viewport.name} calendar`, /Covers:.*2026-10-26 to 2026-11-16/);
  await page.getByLabel("Kind").selectOption("exam");
  await page.getByLabel("Name", { exact: true }).fill("MATH 999 final");
  await page.getByLabel("Starts").fill("2026-11-16T16:00");
  await page.getByLabel("Ends").fill("2026-11-16T18:00");
  await page.getByRole("button", { name: "Add commitment" }).click();
  await expectText(page, `${viewport.name} calendar`, 'Added "MATH 999 final".');
  await checkPage(page, `${viewport.name} calendar after import`);
  await shot("calendar");

  // 5. Detail page: findings, strong warnings and assumptions; shortlist it.
  await visit("/events/demo-lakeshore-hacks", "detail");
  await expectText(page, `${viewport.name} detail`, "Can you attend?");
  await expectText(page, `${viewport.name} detail`, /Strong warning:/);
  await expectText(page, `${viewport.name} detail`, /Travel time: 30 minutes each way \(from your profile\)/);
  await page.getByRole("button", { name: /Save Lakeshore Hacks.* to shortlist/ }).click();
  await shot("detail");
  await visit("/events/demo-pixel-forge-game-jam", "detail 2");
  await page.getByRole("button", { name: /to shortlist/ }).click();

  // 6. Shortlist: compare, clashes, .ics export.
  await visit("/shortlist", "shortlist");
  await expectText(page, `${viewport.name} shortlist`, /Clashes between shortlisted events/);
  await page.getByLabel("Application status").first().selectOption("applied");
  const [ics] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download .ics" }).click()]);
  const icsText = readFileSync(await ics.path(), "utf8");
  if (!icsText.startsWith("BEGIN:VCALENDAR") || !icsText.includes("[DEMO] Lakeshore Hacks")) fail(`${viewport.name} shortlist`, "exported .ics looks wrong");
  await checkPage(page, `${viewport.name} shortlist after edits`);
  await shot("shortlist");

  // 7. Switch off: attendance disappears everywhere, but nothing is deleted.
  const storedBefore = await page.evaluate(() => [localStorage.getItem("can-i-go.calendar.v1"), localStorage.getItem("can-i-go.commitments.v1")]);
  await toggle.click();
  await switchIs(`${viewport.name} toggle off`, false);
  await expectAbsent(page, `${viewport.name} off shortlist`, /Can you attend\?|Clashes between|Travel time for this event/);
  await shot("off-shortlist");
  const storedAfter = await page.evaluate(() => [localStorage.getItem("can-i-go.calendar.v1"), localStorage.getItem("can-i-go.commitments.v1")]);
  if (JSON.stringify(storedBefore) !== JSON.stringify(storedAfter) || !storedAfter[0]) fail(`${viewport.name} toggle off`, "calendar data changed when switching off");
  await visit("/", "off discover with data");
  await expectAbsent(page, `${viewport.name} off discover with data`, /attendance|conflict|Strong warning/i);
  await page.getByRole("link", { name: "What's this?" }).click();
  await page.waitForURL(/\/calendar$/);
  await expectText(page, `${viewport.name} off calendar`, "Your calendar data is still saved on this device. Delete it on the Privacy page.");
  await expectAbsent(page, `${viewport.name} off calendar`, /Import calendars|Your commitments/);
  await checkPage(page, `${viewport.name} off calendar`);
  await shot("off-calendar");

  // 8. Switch back on: everything is restored.
  await page.getByRole("button", { name: "Turn on calendar checks" }).click();
  await switchIs(`${viewport.name} toggle on again`, true);
  await expectText(page, `${viewport.name} calendar restored`, "Connected calendars (2)");
  await expectText(page, `${viewport.name} calendar restored`, /MATH 999 final/);
  await visit("/events/demo-lakeshore-hacks", "detail restored");
  await expectText(page, `${viewport.name} detail restored`, /2 conflicts found/);

  // 9. Privacy: switch state, export and delete everything.
  await visit("/privacy", "privacy");
  await expectText(page, `${viewport.name} privacy`, "Use my calendar is on.");
  await expectText(page, `${viewport.name} privacy`, /Either way, calendar data stays on this device/);
  const [json] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export my data" }).click()]);
  const exported = JSON.parse(readFileSync(await json.path(), "utf8"));
  for (const key of ["can-i-go.profile.v1", "can-i-go.calendar.v1", "can-i-go.commitments.v1", "can-i-go.shortlist.v1", "can-i-go.use-calendar.v1"]) {
    if (exported.data?.[key] == null) fail(`${viewport.name} privacy`, `export is missing ${key}`);
  }
  await shot("privacy");
  await page.getByRole("button", { name: "Delete my data" }).click();
  await expectText(page, `${viewport.name} privacy`, /was deleted from this browser/);
  await expectText(page, `${viewport.name} privacy`, "Use my calendar is off.");
  await switchIs(`${viewport.name} after delete`, false);
  const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("can-i-go.")));
  if (left.length) fail(`${viewport.name} privacy`, `still stored after delete: ${left.join(", ")}`);

  // 10. Dark mode, one page.
  const dark = await browser.newContext({ viewport, colorScheme: "dark" });
  const darkPage = await dark.newPage();
  await darkPage.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await darkPage.screenshot({ path: path.join(OUT, `${viewport.name}-discover-dark.png`), fullPage: true });

  await browser.close();
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  try {
    for (const v of VIEWPORTS) await run(v);
  } finally {
    server.kill();
  }
  if (failures.length) {
    console.error(`UI check failed (${failures.length}):\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`UI check passed at ${VIEWPORTS.map((v) => `${v.width}px`).join(" and ")}. Screenshots in .ui-check/`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
