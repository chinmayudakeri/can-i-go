import { RetryableError, parseRetryAfter } from "../backoff";
import { SYSTEM_INSTRUCTION, buildUserPrompt } from "./prompt";
import { EXTRACTION_SCHEMA } from "./schema";
import { ProviderError, type ExtractionInput, type ExtractionProvider } from "./types";

/**
 * Gemini free tier via the REST API (no SDK). The key is read from .env by
 * the CLI and sent only in the x-goog-api-key header. It never appears in a
 * URL, and every error message is redacted, so it can't leak into logs.
 * Node-only.
 *
 * Retries (via RetryableError) only for network timeouts, 429, 503 and 504.
 * Everything else (request-shape TypeErrors, other network failures,
 * unexpected responses, unparseable output) fails immediately with the
 * underlying cause, since retrying can't fix it.
 */

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Network-level timeouts (Node/undici codes) worth retrying. */
const TIMEOUT_CODES = new Set(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
const RETRYABLE_STATUSES = new Set([429, 503, 504]);
const FATAL_STATUSES = new Set([400, 401, 403, 404]);

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** "TypeError: fetch failed; cause: ECONNRESET socket hang up; stack: at a ← at b". Never includes headers or bodies. */
export function describeError(err: unknown): string {
  const e = err as (Error & { cause?: unknown }) | undefined;
  const parts = [e instanceof Error ? `${e.name}: ${e.message}` : String(err)];
  const cause = e?.cause as (Error & { code?: string }) | undefined;
  if (cause) {
    const label = [cause.code, cause.name && cause.name !== "Error" ? cause.name : null, cause.message].filter(Boolean).join(" ");
    parts.push(`cause: ${label || String(cause)}`);
  }
  const frames = (e?.stack ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("at "))
    .slice(0, 3);
  if (frames.length) parts.push(`stack: ${frames.join(" ← ")}`);
  return parts.join("; ");
}

/** Keys only (never values), so a changed response shape is visible without logging content. */
export function describeShape(status: number, body: unknown): string {
  const parts = [`HTTP ${status}`];
  if (!isObject(body)) return `${parts[0]}; body is not a JSON object`;
  parts.push(`top-level keys: ${Object.keys(body).join(", ") || "(none)"}`);
  const candidate = Array.isArray(body.candidates) ? body.candidates[0] : undefined;
  if (isObject(candidate)) {
    parts.push(`candidate keys: ${Object.keys(candidate).join(", ")}`);
    const content = candidate.content;
    if (isObject(content)) {
      parts.push(`content keys: ${Object.keys(content).join(", ")}`);
      if (Array.isArray(content.parts)) parts.push(`part keys: ${content.parts.map((p) => (isObject(p) ? `[${Object.keys(p).join(",")}]` : typeof p)).join(" ")}`);
    }
  }
  return parts.join("; ");
}

/** Reads Google's RetryInfo hint ("37s") from an error body. */
function retryDelayFromBody(body: unknown): number | undefined {
  const details = (body as { error?: { details?: { retryDelay?: unknown }[] } })?.error?.details;
  for (const d of Array.isArray(details) ? details : []) {
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

  constructor({ apiKey, model = DEFAULT_GEMINI_MODEL, fetchImpl = fetch, timeoutMs = 120_000 }: GeminiOptions) {
    if (!apiKey?.trim()) throw new ProviderError("GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.");
    if (!/^[\w.-]+$/.test(model)) throw new ProviderError(`invalid GEMINI_MODEL "${model}"`);
    this.apiKey = apiKey.trim();
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.name = `gemini (${model})`;
  }

  private redact(s: string): string {
    return s.replaceAll(this.apiKey, "[key]");
  }

  private fail(message: string, fatal = false): ProviderError {
    return new ProviderError(this.redact(message), fatal);
  }

  /** Maps a thrown fetch/body-read error to retryable (timeouts only) or a final ProviderError. */
  private classify(err: unknown, stage: string): Error {
    const detail = this.redact(describeError(err));
    const e = err as (Error & { cause?: { code?: string }; code?: string }) | undefined;
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return new RetryableError(`Gemini ${stage} timed out after ${this.timeoutMs / 1000}s (${detail})`);
    }
    const code = e?.cause?.code ?? e?.code;
    if (code && TIMEOUT_CODES.has(code)) return new RetryableError(`Gemini ${stage} timed out (${detail})`);
    // A TypeError with no network cause comes from building the request (e.g. an invalid header value),
    // so it will fail the same way for every page: stop the run.
    if (e instanceof TypeError && !e.cause) return this.fail(`Gemini ${stage} could not be sent, not retried: ${detail}`, true);
    return this.fail(`Gemini ${stage} failed, not retried: ${detail}`);
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
          // No temperature: Gemini 3 models can loop or stall below the default of 1.0, and
          // determinism isn't needed because every value is verified against the page in code.
          generationConfig: { responseMimeType: "application/json", responseSchema: EXTRACTION_SCHEMA },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw this.classify(err, "request");
    }

    let raw: string;
    try {
      raw = await res.text();
    } catch (err) {
      throw this.classify(err, "response");
    }
    let body: unknown = null;
    try {
      body = JSON.parse(raw);
    } catch {
      // Reported below with the status and content type.
    }

    if (RETRYABLE_STATUSES.has(res.status)) {
      const hint = parseRetryAfter(res.headers.get("retry-after")) ?? retryDelayFromBody(body);
      const status = (body as { error?: { status?: unknown } })?.error?.status;
      throw new RetryableError(`Gemini HTTP ${res.status}${typeof status === "string" ? ` ${status}` : ""} (rate limited or busy)`, hint);
    }
    if (!res.ok) {
      const message = (body as { error?: { message?: unknown } })?.error?.message;
      const hint = res.status === 404 ? " Check GEMINI_MODEL against https://ai.google.dev/gemini-api/docs/models." : "";
      throw this.fail(`Gemini HTTP ${res.status}: ${typeof message === "string" ? message : res.statusText}${hint}`, FATAL_STATUSES.has(res.status));
    }
    if (!isObject(body)) {
      throw this.fail(`Gemini response is not JSON (HTTP ${res.status}, content-type ${res.headers.get("content-type") ?? "none"}, ${raw.length} chars)`);
    }

    const shape = describeShape(res.status, body);
    const candidate = Array.isArray(body.candidates) ? body.candidates[0] : undefined;
    if (!isObject(candidate)) {
      const blocked = (body as { promptFeedback?: { blockReason?: unknown } }).promptFeedback?.blockReason;
      throw this.fail(`Gemini returned no candidates${typeof blocked === "string" ? ` (blocked: ${blocked})` : ""}; ${shape}`);
    }
    const parts = isObject(candidate.content) ? candidate.content.parts : undefined;
    if (!Array.isArray(parts)) throw this.fail(`unexpected Gemini response shape; ${shape}`);

    // Thinking models may return thought-summary parts ({ thought: true }) and attach a
    // thoughtSignature to answer parts. Only non-thought text is the answer.
    const answer = parts
      .filter((p): p is { text: string } => isObject(p) && p.thought !== true && typeof p.text === "string")
      .map((p) => p.text)
      .join("");
    const finish = typeof candidate.finishReason === "string" ? candidate.finishReason : "unknown";
    if (!answer) throw this.fail(`Gemini returned no answer text (finishReason ${finish}); ${shape}`);
    try {
      return JSON.parse(answer);
    } catch {
      throw this.fail(`Gemini output is not valid JSON (finishReason ${finish}, ${answer.length} chars); ${shape}`);
    }
  }
}
