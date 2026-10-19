import { isValidTimeZone } from "@/lib/validate";
import type { GuardedFetch } from "../fetcher";
import { htmlToText, tidyWhitespace } from "../html";
import { parseIcs, type IcsDate, type IcsEvent } from "../ics";
import { hashText } from "../hash";
import { utcToLocal, waterlooDate } from "../time";
import type { FeedConfig, RawDocument, SourceAdapter } from "./types";

const looksLikeHtml = (s: string) => /<\/?[a-z][^>]*>/i.test(s);

/** Renders an iCal date as text the model can quote, converting UTC to the feed's zone when one is known. */
export function renderIcsDate(d: IcsDate, timeZone: string | null): string {
  if (d.time === null) return `${d.date} (all day)`;
  if (d.tzid) return `${d.date} ${d.time} (${d.tzid})`;
  if (d.utc) {
    if (!timeZone) return `${d.date} ${d.time} UTC`;
    const [y, mo, day] = d.date.split("-").map(Number);
    const [h, mi] = d.time.split(":").map(Number);
    const local = utcToLocal(Date.UTC(y, mo - 1, day, h, mi), timeZone);
    return `${local.date} ${local.time} (${timeZone}) [${d.date} ${d.time} UTC]`;
  }
  return `${d.date} ${d.time}`;
}

/** Deterministic text for one event; this is the "page text" quotes must come from. */
export function renderIcsEvent(e: IcsEvent, timeZone: string | null): string {
  const lines = [
    e.summary && `Event: ${e.summary}`,
    e.start && `Start: ${renderIcsDate(e.start, timeZone)}`,
    e.end && `End: ${renderIcsDate(e.end, timeZone)}`,
    e.location && `Location: ${e.location}`,
    e.url && `URL: ${e.url}`,
  ].filter(Boolean);
  if (e.description) {
    const body = looksLikeHtml(e.description) ? htmlToText(e.description) : tidyWhitespace(e.description);
    lines.push("Description:", body);
  }
  return lines.join("\n");
}

export class IcsFeedAdapter implements SourceAdapter {
  readonly name: string;

  constructor(
    private readonly config: FeedConfig,
    private readonly fetch: GuardedFetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.name = config.name;
  }

  async fetchDocuments(): Promise<RawDocument[]> {
    const res = await this.fetch(this.config.url, "ics-feed");
    const calendar = parseIcs(res.text);
    const configured = this.config.timezone && isValidTimeZone(this.config.timezone) ? this.config.timezone : null;
    const timeZone = configured ?? (calendar.timezone && isValidTimeZone(calendar.timezone) ? calendar.timezone : null);
    const today = waterlooDate(this.now().toISOString());
    const keywords = (this.config.keywords ?? []).map((k) => k.toLowerCase());

    const docs: RawDocument[] = [];
    for (const event of calendar.events) {
      if (event.status === "CANCELLED") continue;
      const lastDay = (event.end ?? event.start)?.date;
      if (!lastDay || lastDay < today) continue; // past events aren't worth a call
      const text = renderIcsEvent(event, timeZone);
      if (keywords.length && !keywords.some((k) => text.toLowerCase().includes(k))) continue;
      const id = event.uid ?? hashText(`${event.summary}|${event.start?.date}`);
      docs.push({ itemKey: `ics:${this.config.url}#${id}`, sourceUrl: res.url, fetchedAt: res.fetchedAt, text });
    }
    return docs;
  }
}
