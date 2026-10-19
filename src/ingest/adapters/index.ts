import { isValidTimeZone } from "@/lib/validate";
import type { GuardedFetch } from "../fetcher";
import { checkSitePolicy } from "../policy";
import { parseSafeUrl } from "../safeUrl";
import { IcsFeedAdapter } from "./icsFeed";
import { RssFeedAdapter } from "./rssFeed";
import type { FeedConfig, SourceAdapter } from "./types";

export type { FeedConfig, RawDocument, SourceAdapter } from "./types";
export { IcsFeedAdapter } from "./icsFeed";
export { RssFeedAdapter } from "./rssFeed";
export { SingleUrlAdapter } from "./singleUrl";

export class InvalidFeedConfigError extends Error {}

/** Validates data/real/feeds.json, including URL safety and site policy, before anything is fetched. */
export function parseFeedConfigs(raw: unknown): FeedConfig[] {
  if (!Array.isArray(raw)) throw new InvalidFeedConfigError("feeds.json must be an array");
  return raw.map((item, i) => {
    const f = item as Partial<FeedConfig>;
    const where = `feeds.json[${i}]`;
    if (!f || typeof f.name !== "string" || !f.name.trim()) throw new InvalidFeedConfigError(`${where}: missing "name"`);
    if (f.kind !== "ics" && f.kind !== "rss") throw new InvalidFeedConfigError(`${where}: "kind" must be "ics" or "rss"`);
    const url = parseSafeUrl(f.url);
    const policy = checkSitePolicy(url, f.kind === "ics" ? "ics-feed" : "rss-feed");
    if (!policy.allowed) throw new InvalidFeedConfigError(`${where}: ${policy.reason}`);
    if (f.timezone !== undefined && !isValidTimeZone(f.timezone)) throw new InvalidFeedConfigError(`${where}: invalid "timezone"`);
    if (f.keywords !== undefined && (!Array.isArray(f.keywords) || !f.keywords.every((k) => typeof k === "string" && k.trim()))) {
      throw new InvalidFeedConfigError(`${where}: "keywords" must be a list of words`);
    }
    return { name: f.name, kind: f.kind, url: url.href, timezone: f.timezone, keywords: f.keywords };
  });
}

export function adaptersForFeeds(feeds: FeedConfig[], fetch: GuardedFetch): SourceAdapter[] {
  return feeds.map((f) => (f.kind === "ics" ? new IcsFeedAdapter(f, fetch) : new RssFeedAdapter(f, fetch)));
}
