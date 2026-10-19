import { describe, expect, it, vi } from "vitest";
import {
  FetchError,
  UnsafeUrlError,
  USER_AGENT,
  createSafeLookup,
  isBlockedAddress,
  parseSafeUrl,
  safeFetch,
  type Transport,
  type TransportResponse,
} from "./safeUrl";

const ok = (body: string, contentType = "text/html; charset=utf-8"): TransportResponse => ({
  status: 200,
  headers: { "content-type": contentType },
  body: Buffer.from(body),
});
const redirect = (location: string): TransportResponse => ({ status: 302, headers: { location }, body: Buffer.alloc(0) });

describe("parseSafeUrl", () => {
  it("accepts public http(s) URLs", () => {
    expect(parseSafeUrl("https://example.org/events?x=1").href).toBe("https://example.org/events?x=1");
    expect(parseSafeUrl("  http://hackathon.example.com/ ").hostname).toBe("hackathon.example.com");
  });

  it.each([
    ["file:///etc/passwd", /only http/],
    ["javascript:alert(1)", /only http/],
    ["ftp://example.org/x", /only http/],
    ["data:text/html,hi", /only http/],
    ["gopher://example.org", /only http/],
    ["https://user:pass@example.org/", /credentials/],
    ["https://example.org:8443/", /port/],
    ["not a url", /not a valid URL/],
    ["", /empty/],
  ])("rejects %s", (url, message) => {
    expect(() => parseSafeUrl(url)).toThrow(UnsafeUrlError);
    expect(() => parseSafeUrl(url)).toThrow(message);
  });

  it.each([
    "http://localhost/",
    "http://LOCALHOST./",
    "http://app.localhost/",
    "http://printer.local/",
    "http://intranet/",
    "http://metadata.google.internal/",
    "http://127.0.0.1/",
    "http://127.1/",
    "http://2130706433/",
    "http://0x7f.0.0.1/",
    "http://0.0.0.0/",
    "http://10.1.2.3/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/",
    "http://[::1]/",
    "http://[::]/",
    "http://[fc00::1]/",
    "http://[fd12:3456::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://[64:ff9b::a00:1]/",
    "http://[2002:c0a8:0101::1]/",
  ])("rejects private or local address %s", (url) => {
    expect(() => parseSafeUrl(url)).toThrow(UnsafeUrlError);
  });

  it("allows public IP literals", () => {
    expect(parseSafeUrl("http://93.184.215.14/").hostname).toBe("93.184.215.14");
    expect(parseSafeUrl("http://[2606:4700::1111]/").hostname).toBe("[2606:4700::1111]");
  });
});

describe("isBlockedAddress", () => {
  it.each(["127.0.0.1", "10.0.0.1", "172.20.1.1", "192.168.0.10", "169.254.169.254", "224.0.0.1", "255.255.255.255", "::1", "fe80::1", "fc00::", "ff02::1", "::ffff:10.0.0.1", "2001:db8::1", "2001:0:1::1", "garbage"])(
    "blocks %s",
    (ip) => expect(isBlockedAddress(ip)).toBe(true),
  );
  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) =>
    expect(isBlockedAddress(ip)).toBe(false),
  );
});

describe("createSafeLookup", () => {
  const lookupWith = (addresses: { address: string; family: number }[], options: unknown = {}) =>
    new Promise<{ err: Error | null; result: unknown }>((resolve) => {
      createSafeLookup(async () => addresses)("events.example.org", options, (err, address) => resolve({ err, result: address }));
    });

  it("refuses a hostname that resolves to a private address (DNS rebinding)", async () => {
    const { err } = await lookupWith([{ address: "10.0.0.5", family: 4 }]);
    expect(err).toBeInstanceOf(UnsafeUrlError);
    expect(err?.message).toMatch(/private or local/);
  });

  it("refuses if any resolved address is private", async () => {
    const { err } = await lookupWith([
      { address: "93.184.215.14", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    expect(err).toBeInstanceOf(UnsafeUrlError);
  });

  it("passes public addresses through in both lookup forms", async () => {
    const addresses = [{ address: "93.184.215.14", family: 4 }];
    expect(await lookupWith(addresses)).toEqual({ err: null, result: "93.184.215.14" });
    expect(await lookupWith(addresses, { all: true })).toEqual({ err: null, result: addresses });
  });
});

describe("safeFetch", () => {
  it("fetches text with our user agent and records the time", async () => {
    const transport = vi.fn<Transport>(async () => ok("<p>Hello</p>"));
    const res = await safeFetch("https://example.org/e", { transport, now: () => new Date("2026-10-18T12:00:00Z") });
    expect(res).toMatchObject({ url: "https://example.org/e", status: 200, contentType: "text/html", text: "<p>Hello</p>", fetchedAt: "2026-10-18T12:00:00.000Z" });
    expect(transport.mock.calls[0][1].headers["User-Agent"]).toBe(USER_AGENT);
  });

  it("rejects an unsafe URL before making any request", async () => {
    const transport = vi.fn<Transport>(async () => ok(""));
    await expect(safeFetch("http://169.254.169.254/", { transport })).rejects.toThrow(UnsafeUrlError);
    await expect(safeFetch("file:///etc/passwd", { transport })).rejects.toThrow(UnsafeUrlError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("re-checks every redirect and refuses one that points at a private address", async () => {
    const transport = vi.fn<Transport>(async () => redirect("http://169.254.169.254/latest/meta-data/"));
    await expect(safeFetch("https://example.org/e", { transport })).rejects.toThrow(UnsafeUrlError);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("runs beforeRequest on every hop so policy and robots apply after redirects", async () => {
    const transport = vi.fn<Transport>(async (url) => (url.pathname === "/a" ? redirect("/b") : ok("done")));
    const seen: string[] = [];
    await safeFetch("https://example.org/a", { transport, beforeRequest: (u) => void seen.push(u.pathname) });
    expect(seen).toEqual(["/a", "/b"]);

    const blocked = safeFetch("https://example.org/a", {
      transport,
      beforeRequest: (u) => {
        if (u.pathname === "/b") throw new Error("blocked by policy");
      },
    });
    await expect(blocked).rejects.toThrow("blocked by policy");
  });

  it("limits redirects", async () => {
    let n = 0;
    const transport: Transport = async () => redirect(`/hop${++n}`);
    await expect(safeFetch("https://example.org/", { transport })).rejects.toThrow(/too many redirects/);
    expect(n).toBe(4);
  });

  it("rejects error statuses, oversized bodies and unexpected content types", async () => {
    await expect(safeFetch("https://example.org/", { transport: async () => ({ ...ok(""), status: 404 }) })).rejects.toMatchObject({
      status: 404,
    });
    await expect(safeFetch("https://example.org/", { transport: async () => ok("x".repeat(20)), maxBytes: 10 })).rejects.toThrow(FetchError);
    await expect(safeFetch("https://example.org/", { transport: async () => ok("MZ", "application/octet-stream") })).rejects.toThrow(
      /content type/,
    );
  });
});
