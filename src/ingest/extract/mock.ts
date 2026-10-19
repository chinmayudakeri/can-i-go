import type { ExtractionInput, ExtractionProvider } from "./types";

/**
 * Scripted provider for tests: returns whatever `respond` returns (or
 * throws), and records every call so tests can count them.
 */
export class MockProvider implements ExtractionProvider {
  readonly name = "mock";
  readonly calls: ExtractionInput[] = [];

  constructor(private readonly respond: (input: ExtractionInput, callIndex: number) => unknown | Promise<unknown>) {}

  async extract(input: ExtractionInput): Promise<unknown> {
    this.calls.push(input);
    return this.respond(input, this.calls.length - 1);
  }
}
