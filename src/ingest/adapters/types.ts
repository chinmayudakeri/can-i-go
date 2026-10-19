/** One fetched source document: the untrusted text we extract from and quote-check against. */
export interface RawDocument {
  /** Stable id for this document across runs (feed URL + item id, or page URL). */
  itemKey: string;
  /** Where the text came from; every quote is attributed to this URL. */
  sourceUrl: string;
  /** ISO 8601 time of the fetch. */
  fetchedAt: string;
  /** Plain text (HTML already stripped). */
  text: string;
}

export interface SourceAdapter {
  readonly name: string;
  fetchDocuments(): Promise<RawDocument[]>;
}

export interface FeedConfig {
  name: string;
  kind: "ics" | "rss";
  url: string;
  /** IANA zone to show UTC feed times in, when the feed doesn't say (e.g. a Toronto city calendar). */
  timezone?: string;
  /** Only items mentioning one of these words (case-insensitive) are extracted. Saves calls on busy feeds. */
  keywords?: string[];
}
