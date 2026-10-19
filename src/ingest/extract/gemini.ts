import { RetryableError, parseRetryAfter } from "../backoff";
import { SYSTEM_INSTRUCTION, buildUserPrompt } from "./prompt";
import { EXTRACTION_SCHEMA } from "./schema";
import { ProviderError, type ExtractionInput, type ExtractionProvider } from "./types";

/**
 * Gemini free tier via the REST API (no SDK). The key is read from .env by
 * the CLI and sent only in the x-goog-api-key header, never in a URL, log or
 * error message. Node-only.
 */

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Reads Google's RetryInfo hint ("37s") from an error body. */
function retryDelayFromBody(body: unknown): number | undefined {
  const details = (body as { error?: { details?: { retryDelay?: unknown }[] } })?.error?.details ?? [];
  for (const d of details) {
    const m = typeof d?.retryDelay === "string" ? /^(\d+(?:\.\d+)?)s$/.exec(d.retryDelay) : null;
    if (m) return Math.round(Number(m[1]) * 1000);
  }
  return undefined;
}

export class GeminiProvider implements ExtractionProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor({ apiKey, model = DEFAULT_GEMINI_MODEL, fetchImpl = fetch, timeoutMs = 60_000 }: GeminiOptions) {
    if (!apiKey?.trim()) throw new ProviderError("GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.");
    if (!/^[\w.-]+$/.test(model)) throw new ProviderError(`invalid GEMINI_MODEL "${model}"`);
    this.apiKey = apiKey.trim();
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.name = `gemini (${model})`;
  }

  async extract({ text, sourceUrl }: ExtractionInput): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${ENDPOINT}/${this.model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ role: "user", parts: [{ text: buildUserPrompt(text, sourceUrl) }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: EXTRACTION_SCHEMA },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new RetryableError(`Gemini request failed: ${(err as Error).name}`);
    }

    const body: unknown = await res.json().catch(() => null);
    if (res.status === 429 || res.status === 500 || res.status === 503) {
      const hint = parseRetryAfter(res.headers.get("retry-after")) ?? retryDelayFromBody(body);
      throw new RetryableError(`Gemini HTTP ${res.status} (rate limited or busy)`, hint);
    }
    if (!res.ok) {
      const message = (body as { error?: { message?: string } })?.error?.message ?? res.statusText;
      const hint = res.status === 404 ? " Check GEMINI_MODEL against https://ai.google.dev/gemini-api/docs/models." : "";
      const fatal = [400, 401, 403, 404].includes(res.status);
      throw new ProviderError(`Gemini HTTP ${res.status}: ${String(message).replaceAll(this.apiKey, "[key]")}${hint}`, fatal);
    }

    const candidate = (body as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] })?.candidates?.[0];
    const output = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!output) throw new ProviderError(`Gemini returned no content (finishReason: ${candidate?.finishReason ?? "unknown"})`);
    try {
      return JSON.parse(output);
    } catch {
      throw new ProviderError("Gemini returned invalid JSON");
    }
  }
}
