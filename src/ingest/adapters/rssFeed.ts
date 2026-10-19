import type { GuardedFetch } from "../fetcher";
import { htmlToText } from "../html";
import { parseFeed } from "../rss";
import { hashText } from "../hash";
import type { FeedConfig, RawDocument, SourceAdapter } from "./types";

/** One document per feed item. Linked pages are not fetched; add them with --url if needed. */
export class RssFeedAdapter implements SourceAdapter {
  readonly name: string;

  constructor(
    private readonly config: FeedConfig,
    private readonly fetch: GuardedFetch,
  ) {
    this.name = config.name;
  }

  async fetchDocuments(): Promise<RawDocument[]> {
    const res = await this.fetch(this.config.url, "rss-feed");
    const keywords = (this.config.keywords ?? []).map((k) => k.toLowerCase());
    const docs: RawDocument[] = [];
    for (const item of parseFeed(res.text)) {
      const lines = [
        item.title && `Title: ${htmlToText(item.title)}`,
        item.link && `Link: ${item.link}`,
        item.published && `Published: ${item.published}`,
      ].filter(Boolean);
      const body = item.description ? htmlToText(item.description, item.link ?? res.url) : "";
      const text = [lines.join("\n"), body].filter(Boolean).join("\n\n");
      if (!text) continue;
      if (keywords.length && !keywords.some((k) => text.toLowerCase().includes(k))) continue;
      const id = item.id ?? item.link ?? hashText(text);
      docs.push({ itemKey: `rss:${this.config.url}#${id}`, sourceUrl: res.url, fetchedAt: res.fetchedAt, text });
    }
    return docs;
  }
}
