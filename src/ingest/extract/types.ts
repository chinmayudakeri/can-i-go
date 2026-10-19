export interface ExtractionInput {
  /** Prepared page text (see prepareText). Untrusted. */
  text: string;
  sourceUrl: string;
}

/**
 * Anything that can propose field values from page text. The return value is
 * untrusted: extractOpportunity parses it into a fixed shape and verifies
 * every value against the page before anything is kept.
 */
export interface ExtractionProvider {
  readonly name: string;
  extract(input: ExtractionInput): Promise<unknown>;
}

/** A provider failure that retrying won't fix (bad key, bad model, malformed response). */
export class ProviderError extends Error {
  constructor(
    message: string,
    /** Configuration problems (bad key or model) that will fail for every page, so the run should stop. */
    readonly fatal = false,
  ) {
    super(message);
  }
}
