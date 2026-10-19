import { XMLParser } from "fast-xml-parser";

/** Reads RSS 2.0 and Atom feeds into a flat list of items. */

export interface FeedItem {
  id: string | null;
  title: string | null;
  link: string | null;
  /** Raw description/summary/content, which may contain HTML. */
  description: string | null;
  published: string | null;
}

export class FeedParseError extends Error {}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  cdataPropName: false,
  // Only the five XML built-in entities; DOCTYPE entities are refused below anyway.
  processEntities: true,
  htmlEntities: false,
  parseTagValue: false,
  trimValues: true,
});

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function text(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" || typeof v === "number") return String(v).trim() || null;
  if (typeof v === "object" && "#text" in (v as object)) return text((v as Record<string, unknown>)["#text"]);
  return null;
}

export function parseFeed(xml: string): FeedItem[] {
  // Refuse DTDs outright: they enable entity-expansion attacks and feeds don't need them.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new FeedParseError("feeds with a DOCTYPE are not supported");
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    throw new FeedParseError(`not valid XML: ${(err as Error).message}`);
  }

  const rss = doc.rss as { channel?: { item?: unknown } } | undefined;
  if (rss?.channel) {
    return asArray(rss.channel.item as Record<string, unknown>[]).map((item) => ({
      id: text(item.guid),
      title: text(item.title),
      link: text(item.link),
      description: text(item["content:encoded"]) ?? text(item.description),
      published: text(item.pubDate),
    }));
  }

  const feed = doc.feed as { entry?: unknown } | undefined;
  if (feed) {
    return asArray(feed.entry as Record<string, unknown>[]).map((entry) => {
      const links = asArray(entry.link as Record<string, string>[]);
      const link = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
      return {
        id: text(entry.id),
        title: text(entry.title),
        link: link?.["@_href"]?.trim() || null,
        description: text(entry.content) ?? text(entry.summary),
        published: text(entry.published) ?? text(entry.updated),
      };
    });
  }

  throw new FeedParseError("not an RSS or Atom feed");
}
