import { describe, expect, it, vi } from "vitest";
import { RetryableError, withBackoff } from "../backoff";
import { CallBudget } from "../budget";
import { PAGE, PAGE_URL, goodResponse } from "../testFixtures";
import { GeminiProvider, describeShape } from "./gemini";
import { ProviderError } from "./types";

const KEY = "AIzaTestKey-0123456789";
const input = { text: PAGE, sourceUrl: PAGE_URL };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** Gemini 2.x shape: one text part. */
const v2Response = (payload: unknown) => ({
  candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(payload) }] }, finishReason: "STOP", index: 0 }],
  usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 400, totalTokenCount: 1300 },
  modelVersion: "gemini-2.5-flash",
});

/**
 * Gemini 3 thinking-model shape: an optional thought-summary part, the answer
 * split across parts with a thoughtSignature attached, and thought tokens in
 * usage. Built from Google's Gemini 3 docs; not yet captured live from 3.8
 * Flash (it was returning 503 when this was written).
 */
const v3Response = (payload: unknown) => {
  const text = JSON.stringify(payload);
  return {
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            { text: "**Reading the page** I should find the dates first…", thought: true },
            { text: text.slice(0, 40), thoughtSignature: "c2lnbmF0dXJl" },
            { text: text.slice(40) },
          ],
        },
        finishReason: "STOP",
        index: 0,
      },
    ],
    usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 400, thoughtsTokenCount: 1200, totalTokenCount: 2500 },
    modelVersion: "gemini-3.8-flash",
    responseId: "abc123",
  };
};

const provider = (fetchImpl: typeof fetch, model = "gemini-3.8-flash") => new GeminiProvider({ apiKey: KEY, model, fetchImpl, timeoutMs: 50 });
const failure = (p: Promise<unknown>) =>
  p.then(
    (): never => {
      throw new Error("expected the call to fail");
    },
    (e: unknown) => e as Error & { fatal?: boolean; retryAfterMs?: number },
  );
/** Runs through the real retry loop to count attempts. */
const attempts = async (fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>) => {
  await withBackoff(() => provider(fetchImpl).extract(input), { budget: new CallBudget(10), sleep: async () => {} }).catch(() => {});
  return fetchImpl.mock.calls.length;
};

describe("GeminiProvider: response shapes", () => {
  it("parses the Gemini 2.x shape", async () => {
    const out = await provider(async () => json(v2Response(goodResponse())), "gemini-2.5-flash").extract(input);
    expect(out).toEqual(goodResponse());
  });

  it("parses the Gemini 3 shape: skips thought parts and joins answer parts with thoughtSignature", async () => {
    const out = await provider(async () => json(v3Response(goodResponse()))).extract(input);
    expect(out).toEqual(goodResponse());
  });

  it("reports status and keys (not values) when the shape is unexpected, and doesn't retry", async () => {
    // e.g. an Interactions-API-style body instead of generateContent's
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ outputs: [{ type: "text", text: "{}" }], usage: { total: 5 } }));
    const err = await failure(provider(fetchImpl).extract(input));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain("HTTP 200; top-level keys: outputs, usage");
    expect(err.message).not.toContain('"text"');
    expect(await attempts(vi.fn<typeof fetch>(async () => json({ outputs: [] })))).toBe(1);
  });

  it("reports candidate, content and part keys when parts are missing", async () => {
    const body = { candidates: [{ content: { role: "model" }, finishReason: "MAX_TOKENS" }], usageMetadata: {} };
    const err = await failure(provider(async () => json(body)).extract(input));
    expect(err.message).toMatch(/unexpected Gemini response shape; HTTP 200; top-level keys: candidates, usageMetadata; candidate keys: content, finishReason; content keys: role/);
  });

  it("explains when only thoughts came back (e.g. ran out of tokens while thinking)", async () => {
    const body = { candidates: [{ content: { parts: [{ text: "thinking…", thought: true }] }, finishReason: "MAX_TOKENS" }] };
    const err = await failure(provider(async () => json(body)).extract(input));
    expect(err.message).toMatch(/no answer text \(finishReason MAX_TOKENS\).*part keys: \[text,thought\]/);
  });

  it("reports blocked prompts", async () => {
    const err = await failure(provider(async () => json({ promptFeedback: { blockReason: "SAFETY" } })).extract(input));
    expect(err.message).toMatch(/no candidates \(blocked: SAFETY\); HTTP 200; top-level keys: promptFeedback/);
  });

  it("doesn't retry output that isn't JSON, and says how long it was", async () => {
    const body = { candidates: [{ content: { parts: [{ text: "Sure! Here you go" }] }, finishReason: "STOP" }] };
    const fetchImpl = vi.fn<typeof fetch>(async () => json(body));
    const err = await failure(provider(fetchImpl).extract(input));
    expect(err.message).toMatch(/output is not valid JSON \(finishReason STOP, 17 chars\); HTTP 200; top-level keys: candidates/);
    expect(await attempts(fetchImpl)).toBe(2); // 1 above + 1 here: no retry
  });

  it("doesn't retry a non-JSON HTTP body", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("<html>proxy error</html>", { status: 200, headers: { "content-type": "text/html" } }));
    const err = await failure(provider(fetchImpl).extract(input));
    expect(err.message).toMatch(/not JSON \(HTTP 200, content-type text\/html, 24 chars\)/);
  });

  it("describeShape lists keys only", () => {
    expect(describeShape(200, v3Response({ secret: "value" }))).toBe(
      "HTTP 200; top-level keys: candidates, usageMetadata, modelVersion, responseId; candidate keys: content, finishReason, index; content keys: role, parts; part keys: [text,thought] [text,thoughtSignature] [text]",
    );
    expect(describeShape(502, null)).toBe("HTTP 502; body is not a JSON object");
  });
});

describe("GeminiProvider: errors and retries", () => {
  it("includes the underlying message, cause and stack summary for network failures, and doesn't retry them", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET", name: "SocketError" }) });
    });
    const err = await failure(provider(fetchImpl).extract(input));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.fatal).toBe(false);
    expect(err.message).toMatch(/Gemini request failed, not retried: TypeError: fetch failed; cause: UND_ERR_SOCKET SocketError other side closed; stack: at /);
    expect(await attempts(fetchImpl)).toBe(2);
  });

  it("treats a request-shape TypeError as fatal, and redacts the key even if the message contains it", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError(`Headers.append: "${KEY}\n" is an invalid header value.`);
    });
    const err = await failure(provider(fetchImpl).extract(input));
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.fatal).toBe(true);
    expect(err.message).toMatch(/could not be sent, not retried: TypeError: Headers\.append: "\[key\]/);
    expect(err.message).not.toContain(KEY);
  });

  it("never puts headers or the request body in error messages", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed", { cause: new Error("ECONNRESET") });
    });
    const err = await failure(provider(fetchImpl).extract(input));
    expect(err.message).not.toMatch(/x-goog-api-key|content-type|AIza|PAGE_TEXT|Maple Hacks/);
  });

  it.each([
    ["our own timeout", () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })],
    ["a connect timeout", () => new TypeError("fetch failed", { cause: Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" }) })],
    ["a headers timeout", () => new TypeError("fetch failed", { cause: Object.assign(new Error("Headers Timeout Error"), { code: "UND_ERR_HEADERS_TIMEOUT" }) })],
    ["ETIMEDOUT", () => new TypeError("fetch failed", { cause: Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }) })],
  ])("retries %s", async (_name, make) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw make();
    });
    const err = await failure(provider(fetchImpl).extract(input));
    expect(err).toBeInstanceOf(RetryableError);
    expect(err.message).toMatch(/timed out/);
    expect(await attempts(fetchImpl)).toBe(1 + 5);
  });

  it("really times out a stalled request", async () => {
    const stalled: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)));
    const err = await failure(provider(stalled).extract(input));
    expect(err).toBeInstanceOf(RetryableError);
    expect(err.message).toMatch(/request timed out after 0.05s \(TimeoutError/);
  });

  it.each([
    [429, "RESOURCE_EXHAUSTED"],
    [503, "UNAVAILABLE"],
    [504, "DEADLINE_EXCEEDED"],
  ])("retries HTTP %i with the server's delay", async (status, statusName) => {
    const body = { error: { code: status, status: statusName, message: "busy", details: [{ retryDelay: "37s" }] } };
    const fetchImpl = vi.fn<typeof fetch>(async () => json(body, status));
    const err = await failure(provider(fetchImpl).extract(input));
    expect(err).toBeInstanceOf(RetryableError);
    expect(err.retryAfterMs).toBe(37_000);
    expect(err.message).toContain(`HTTP ${status} ${statusName}`);
  });

  it("doesn't retry HTTP 500", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ error: { code: 500, message: "Internal error" } }, 500));
    expect(await attempts(fetchImpl)).toBe(1);
  });

  it("treats bad keys and models as fatal, without echoing the key", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ error: { message: `API key not valid: ${KEY}` } }, 400));
    const err = await failure(provider(fetchImpl).extract(input));
    expect(err).toMatchObject({ fatal: true });
    expect(err.message).toContain("[key]");
    expect(err.message).not.toContain(KEY);
    const missing = await failure(provider(async () => json({ error: { message: "model not found" } }, 404)).extract(input));
    expect(missing.message).toMatch(/Check GEMINI_MODEL/);
  });
});

describe("GeminiProvider: request", () => {
  it("sends the key only in a header, with no temperature (Gemini 3 loops below 1.0) and no tools", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json(v3Response(goodResponse())));
    await provider(fetchImpl).extract(input);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    expect(String(url)).not.toContain(KEY);
    expect((init!.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    const body = JSON.parse(String(init!.body));
    expect(body.generationConfig).toEqual({ responseMimeType: "application/json", responseSchema: expect.any(Object) });
    expect(body.tools).toBeUndefined();
  });

  it("defaults to gemini-3.8-flash (2.5 Flash is closed to new users)", () => {
    expect(new GeminiProvider({ apiKey: "k" }).name).toBe("gemini (gemini-3.8-flash)");
  });

  it("requires a key and a sane model name", () => {
    expect(() => new GeminiProvider({ apiKey: "" })).toThrow(/GEMINI_API_KEY/);
    expect(() => new GeminiProvider({ apiKey: "k", model: "../../evil" })).toThrow(/GEMINI_MODEL/);
  });
});
