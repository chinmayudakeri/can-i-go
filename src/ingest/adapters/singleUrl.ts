import { FetchError, parseSafeUrl } from "../safeUrl";
import type { GuardedFetch } from "../fetcher";
import { htmlToText, tidyWhitespace } from "../html";
import type { RawDocument, SourceAdapter } from "./types";

/** `npm run ingest -- --url <link>`: one event page you chose to add. */
export class SingleUrlAdapter implements SourceAdapter {
  readonly name: string;
  private readonly url: URL;

  constructor(
    rawUrl: string,
    private readonly fetch: GuardedFetch,
  ) {
    this.url = parseSafeUrl(rawUrl);
    this.url.hash = "";
    this.name = `URL ${this.url.href}`;
  }

  async fetchDocuments(): Promise<RawDocument[]> {
    const res = await this.fetch(this.url.href, "page");
    let text: string;
    if (res.contentType === "text/html" || res.contentType === "application/xhtml+xml") text = htmlToText(res.text, res.url);
    else if (res.contentType === "text/plain") text = tidyWhitespace(res.text);
    else throw new FetchError(`${res.contentType} isn't an event page; add calendar or RSS feeds to data/real/feeds.json instead`);
    if (!text.trim()) throw new FetchError(`no readable text at ${res.url} (it may need JavaScript to render)`);
    return [{ itemKey: `page:${this.url.href}`, sourceUrl: res.url, fetchedAt: res.fetchedAt, text }];
  }
}
