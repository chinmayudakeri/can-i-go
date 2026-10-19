import { describe, expect, it, vi } from "vitest";
import { IcsFeedAdapter, RssFeedAdapter, SingleUrlAdapter, parseFeedConfigs } from "./adapters";
import { renderIcsDate } from "./adapters/icsFeed";
import { BlockedError, createGuardedFetch, type GuardedFetch } from "./fetcher";
import { parseIcs } from "./ics";
import { RobotsChecker } from "./robots";
import { FeedParseError, parseFeed } from "./rss";
import { UnsafeUrlError, type FetchResult, type Transport } from "./safeUrl";

const ICS = [
  "BEGIN:VCALENDAR",
  "X-WR-TIMEZONE:America/Toronto",
  "BEGIN:VEVENT",
  "UID:maple-2026@example",
  "SUMMARY:Maple Hacks 2026",
  "DTSTART:20261114T140000Z",
  "DTEND:20261115T220000Z",
  "LOCATION:Fictional Hall\\, Waterloo\\, ON",
  "DESCRIPTION:A 24-hour student hackathon.\\nApplications close November 1 at 11:59 PM ET.\\n",
  " Open to all university students.",
  "URL:https://maple.example/2026",
  "BEGIN:VALARM",
  "DESCRIPTION:Reminder (should be ignored)",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:old@example",
  "SUMMARY:Last year's hackathon",
  "DTSTART;VALUE=DATE:20251114",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:meetup@example",
  "SUMMARY:Coffee meetup",
  "DTSTART;TZID=America/Toronto:20261120T180000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:cancelled@example",
  "SUMMARY:Cancelled hackathon",
  "STATUS:CANCELLED",
  "DTSTART;VALUE=DATE:20261201",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const result = (text: string, contentType: string, url = "https://feeds.example.org/cal.ics"): FetchResult => ({
  url,
  status: 200,
  contentType,
  text,
  fetchedAt: "2026-10-18T16:00:00.000Z",
});

describe("parseIcs", () => {
  it("unfolds lines, unescapes text, reads dates and skips nested components", () => {
    const cal = parseIcs(ICS);
    expect(cal.timezone).toBe("America/Toronto");
    expect(cal.events).toHaveLength(4);
    const [maple, old, meetup] = cal.events;
    expect(maple).toMatchObject({
      uid: "maple-2026@example",
      location: "Fictional Hall, Waterloo, ON",
      description: "A 24-hour student hackathon.\nApplications close November 1 at 11:59 PM ET.\nOpen to all university students.",
      start: { date: "2026-11-14", time: "14:00", utc: true, tzid: null },
    });
    expect(old.start).toEqual({ date: "2025-11-14", time: null, tzid: null, utc: false });
    expect(meetup.start).toMatchObject({ time: "18:00", tzid: "America/Toronto" });
  });

  it("renders UTC times in the feed's timezone, keeping the UTC original", () => {
    expect(renderIcsDate({ date: "2026-11-14", time: "14:00", tzid: null, utc: true }, "America/Toronto")).toBe(
      "2026-11-14 09:00 (America/Toronto) [2026-11-14 14:00 UTC]",
    );
    expect(renderIcsDate({ date: "2026-11-14", time: "14:00", tzid: null, utc: true }, null)).toBe("2026-11-14 14:00 UTC");
    expect(renderIcsDate({ date: "2026-11-14", time: null, tzid: null, utc: false }, null)).toBe("2026-11-14 (all day)");
  });
});

describe("IcsFeedAdapter", () => {
  const fetch = vi.fn<GuardedFetch>(async () => result(ICS, "text/calendar"));
  const now = () => new Date("2026-10-18T12:00:00Z");

  it("returns one document per upcoming event, with source URL and fetch time", async () => {
    const docs = await new IcsFeedAdapter({ name: "Cal", kind: "ics", url: "https://feeds.example.org/cal.ics" }, fetch, now).fetchDocuments();
    expect(fetch).toHaveBeenCalledWith("https://feeds.example.org/cal.ics", "ics-feed");
    expect(docs.map((d) => d.itemKey)).toEqual([
      "ics:https://feeds.example.org/cal.ics#maple-2026@example",
      "ics:https://feeds.example.org/cal.ics#meetup@example",
    ]);
    expect(docs[0]).toMatchObject({ sourceUrl: "https://feeds.example.org/cal.ics", fetchedAt: "2026-10-18T16:00:00.000Z" });
    expect(docs[0].text).toBe(
      [
        "Event: Maple Hacks 2026",
        "Start: 2026-11-14 09:00 (America/Toronto) [2026-11-14 14:00 UTC]",
        "End: 2026-11-15 17:00 (America/Toronto) [2026-11-15 22:00 UTC]",
        "Location: Fictional Hall, Waterloo, ON",
        "URL: https://maple.example/2026",
        "Description:",
        "A 24-hour student hackathon.\nApplications close November 1 at 11:59 PM ET.\nOpen to all university students.",
      ].join("\n"),
    );
  });

  it("filters by keywords to save calls", async () => {
    const docs = await new IcsFeedAdapter({ name: "Cal", kind: "ics", url: "https://feeds.example.org/cal.ics", keywords: ["hackathon"] }, fetch, now).fetchDocuments();
    expect(docs).toHaveLength(1);
  });
});

describe("parseFeed / RssFeedAdapter", () => {
  const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Events</title>
    <item><guid>e1</guid><title>Maple Hacks 2026</title><link>https://maple.example/2026</link>
    <description><![CDATA[<p>Applications close <b>November 1</b>.</p><script>alert(1)</script>]]></description></item>
    <item><title>Book club</title><link>https://club.example/books</link></item>
  </channel></rss>`;
  const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>a1</id><title>Maple Hacks</title>
    <link rel="alternate" href="https://maple.example/a"/><summary>Free for students &amp; alumni</summary></entry></feed>`;

  it("reads RSS and Atom", () => {
    expect(parseFeed(RSS)[0]).toMatchObject({ id: "e1", title: "Maple Hacks 2026", link: "https://maple.example/2026" });
    expect(parseFeed(ATOM)).toEqual([{ id: "a1", title: "Maple Hacks", link: "https://maple.example/a", description: "Free for students & alumni", published: null }]);
  });

  it("refuses DOCTYPEs (entity expansion) and non-feeds", () => {
    expect(() => parseFeed(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><rss><channel/></rss>`)).toThrow(FeedParseError);
    expect(() => parseFeed("<html><body>hi</body></html>")).toThrow(/not an RSS or Atom/);
  });

  it("turns each item into plain text, stripping HTML", async () => {
    const fetch = vi.fn<GuardedFetch>(async () => result(RSS, "application/rss+xml", "https://feeds.example.org/rss"));
    const docs = await new RssFeedAdapter({ name: "RSS", kind: "rss", url: "https://feeds.example.org/rss", keywords: ["hacks"] }, fetch).fetchDocuments();
    expect(fetch).toHaveBeenCalledWith("https://feeds.example.org/rss", "rss-feed");
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ itemKey: "rss:https://feeds.example.org/rss#e1" });
    expect(docs[0].text).toBe("Title: Maple Hacks 2026\nLink: https://maple.example/2026\n\nApplications close November 1.");
  });
});

describe("SingleUrlAdapter", () => {
  const allowAllRobots = new RobotsChecker(async () => ({ status: 404, text: "" }));
  const html = (body: string): Transport => async () => ({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from(body) });

  it("fetches one page and strips its HTML", async () => {
    const fetch = createGuardedFetch({ transport: html("<title>Maple</title><p>Hello</p>"), robots: allowAllRobots });
    const [doc] = await new SingleUrlAdapter("https://maple.example/2026#apply", fetch).fetchDocuments();
    expect(doc).toMatchObject({ itemKey: "page:https://maple.example/2026", sourceUrl: "https://maple.example/2026", text: "Maple\n\nHello" });
  });

  it("rejects unsafe URLs up front", () => {
    const fetch = createGuardedFetch({ transport: html(""), robots: allowAllRobots });
    for (const url of ["file:///etc/passwd", "http://localhost:3000/", "http://10.0.0.1/", "javascript:alert(1)"]) {
      expect(() => new SingleUrlAdapter(url, fetch)).toThrow(UnsafeUrlError);
    }
  });

  it("refuses Devpost, MLH and Luma pages without fetching them", async () => {
    const transport = vi.fn<Transport>(html("<p>x</p>"));
    const fetch = createGuardedFetch({ transport, robots: allowAllRobots });
    for (const url of ["https://devpost.com/hackathons", "https://mlh.io/seasons/2027/events", "https://lu.ma/maple"]) {
      await expect(new SingleUrlAdapter(url, fetch).fetchDocuments()).rejects.toThrow(BlockedError);
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it("obeys robots.txt", async () => {
    const transport = vi.fn<Transport>(html("<p>x</p>"));
    const robots = new RobotsChecker(async () => ({ status: 200, text: "User-agent: *\nDisallow: /private" }));
    const fetch = createGuardedFetch({ transport, robots });
    await expect(new SingleUrlAdapter("https://maple.example/private/page", fetch).fetchDocuments()).rejects.toThrow(/robots\.txt disallows/);
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses non-page content", async () => {
    const transport: Transport = async () => ({ status: 200, headers: { "content-type": "text/calendar" }, body: Buffer.from(ICS) });
    const fetch = createGuardedFetch({ transport, robots: allowAllRobots });
    await expect(new SingleUrlAdapter("https://maple.example/cal", fetch).fetchDocuments()).rejects.toThrow(/feeds\.json/);
  });
});

describe("parseFeedConfigs", () => {
  it("accepts valid feeds, including Luma iCal subscriptions", () => {
    expect(
      parseFeedConfigs([
        { name: "Luma Toronto", kind: "ics", url: "https://api.lu.ma/ics/get?entity=discover&id=x", timezone: "America/Toronto", keywords: ["hackathon"] },
        { name: "Club news", kind: "rss", url: "https://club.example/feed.xml" },
      ]),
    ).toHaveLength(2);
  });

  it.each([
    [{ name: "x", kind: "ics", url: "https://devpost.com/feed.ics" }, /Devpost/],
    [{ name: "x", kind: "rss", url: "https://lu.ma/feed" }, /Luma/],
    [{ name: "x", kind: "ics", url: "http://127.0.0.1/cal.ics" }, /private or local/],
    [{ name: "x", kind: "html", url: "https://club.example/" }, /kind/],
    [{ kind: "ics", url: "https://club.example/" }, /name/],
    [{ name: "x", kind: "ics", url: "https://club.example/", timezone: "EST" }, /timezone/],
  ])("rejects %j", (feed, message) => {
    expect(() => parseFeedConfigs([feed])).toThrow(message);
  });
});
