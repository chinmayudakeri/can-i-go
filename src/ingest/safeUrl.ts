import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * Network safety for ingestion. Node-only: never import this from the frontend.
 *
 * Every URL is checked before each request (including every redirect hop), and
 * the resolved IP is checked again at connect time inside the socket lookup,
 * so a hostname can't pass the check and then resolve to a private address.
 */

export const USER_AGENT_TOKEN = "CanIGoBot";
export const USER_AGENT = `${USER_AGENT_TOKEN}/0.2 (+https://github.com/chinmayudakeri/can-i-go)`;

export class UnsafeUrlError extends Error {}
export class FetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".arpa", ".onion"];

/** Parses and checks a URL. Throws `UnsafeUrlError` unless it's a public http(s) URL. */
export function parseSafeUrl(raw: unknown): URL {
  if (typeof raw !== "string" || !raw.trim()) throw new UnsafeUrlError("URL is empty");
  if (raw.length > 2048) throw new UnsafeUrlError("URL is too long");
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError(`not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`only http(s) URLs are allowed, got "${url.protocol}"`);
  }
  if (url.username || url.password) throw new UnsafeUrlError("URLs with credentials are not allowed");
  if (url.port) throw new UnsafeUrlError("URLs with a custom port are not allowed");

  // WHATWG URL already normalizes odd IPv4 forms (0x7f.1, 2130706433) to dotted decimal.
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw new UnsafeUrlError(`private or local address: ${host}`);
    return url;
  }
  if (!host.includes(".")) throw new UnsafeUrlError(`not a public hostname: ${host}`);
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeUrlError(`not a public hostname: ${host}`);
  }
  return url;
}

// ---------------------------------------------------------------------------
// IP classification

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
];

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, octet) => (n << 8) + Number(octet), 0) >>> 0;
}

function isBlockedV4Int(ip: number): boolean {
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ip & mask) >>> 0 === (v4ToInt(base) & mask) >>> 0;
  });
}

/** Expands an IPv6 address to eight 16-bit groups, or null if malformed. */
function parseV6(input: string): number[] | null {
  let s = input.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const tail: number[] = [];
  const v4Match = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4Match) {
    if (!net.isIPv4(v4Match[1])) return null;
    const n = v4ToInt(v4Match[1]);
    tail.push(n >>> 16, n & 0xffff);
    s = s.slice(0, -v4Match[1].length);
    if (s.endsWith(":") && !s.endsWith("::")) s = s.slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string) => (part ? part.split(":") : []);
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  if (![...head, ...rest].every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  const known = head.length + rest.length + tail.length;
  if (halves.length === 1 ? known !== 8 : known > 7) return null;
  const zeros = new Array(8 - known).fill(0);
  return [...head.map((g) => parseInt(g, 16)), ...zeros, ...rest.map((g) => parseInt(g, 16)), ...tail];
}

function isBlockedV6(groups: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const embeddedV4 = ((g6 << 16) | g7) >>> 0;
  const zeroTo = (n: number) => groups.slice(0, n).every((g) => g === 0);

  if (zeroTo(5) && g5 === 0xffff) return isBlockedV4Int(embeddedV4); // ::ffff:a.b.c.d (IPv4-mapped)
  if (zeroTo(6)) return true; // ::, ::1, deprecated IPv4-compatible
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return isBlockedV4Int(embeddedV4); // NAT64
  if ((g0 & 0xe000) !== 0x2000) return true; // outside global unicast 2000::/3: ULA, link-local, multicast, reserved
  if (g0 === 0x2001 && g1 === 0) return true; // Teredo
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  if (g0 === 0x2002) return isBlockedV4Int(((g1 << 16) | g2) >>> 0); // 6to4
  return false;
}

/** True for any address we must never connect to (private, loopback, link-local, multicast, reserved), or a non-IP. */
export function isBlockedAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "");
  if (net.isIPv4(bare)) return isBlockedV4Int(v4ToInt(bare));
  if (net.isIPv6(bare)) {
    const groups = parseV6(bare);
    return groups === null || isBlockedV6(groups);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Connect-time DNS check

export interface ResolvedAddress {
  address: string;
  family: number;
}
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

const systemResolver: Resolver = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | ResolvedAddress[], family?: number) => void;

/**
 * A `lookup` for node:http(s) that refuses the connection if the hostname
 * resolves to any blocked address. Handles both the single and `all` forms.
 */
export function createSafeLookup(resolve: Resolver = systemResolver) {
  return (hostname: string, options: unknown, callback: LookupCallback): void => {
    const cb = (typeof options === "function" ? options : callback) as LookupCallback;
    const all = typeof options === "object" && options !== null && (options as { all?: boolean }).all === true;
    resolve(hostname)
      .then((addresses) => {
        if (!addresses.length) throw new UnsafeUrlError(`could not resolve ${hostname}`);
        const bad = addresses.find((a) => isBlockedAddress(a.address));
        if (bad) throw new UnsafeUrlError(`${hostname} resolves to a private or local address (${bad.address})`);
        if (all) cb(null, addresses);
        else cb(null, addresses[0].address, addresses[0].family);
      })
      .catch((err: NodeJS.ErrnoException) => cb(err, ""));
  };
}

// ---------------------------------------------------------------------------
// Fetching

export interface TransportResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: Buffer;
}
export interface TransportOptions {
  timeoutMs: number;
  maxBytes: number;
  headers: Record<string, string>;
}
export type Transport = (url: URL, options: TransportOptions) => Promise<TransportResponse>;

/** Real network transport: node:http(s) with the safe lookup, a size cap and a hard timeout. */
export function createNodeTransport(resolve?: Resolver): Transport {
  const lookup = createSafeLookup(resolve);
  return (url, { timeoutMs, maxBytes, headers }) =>
    new Promise((resolvePromise, reject) => {
      const mod = url.protocol === "https:" ? https : http;
      const req = mod.request(
        url,
        { method: "GET", headers, lookup: lookup as unknown as net.LookupFunction, agent: false },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) req.destroy(new FetchError(`response is larger than ${maxBytes} bytes`));
            else chunks.push(chunk);
          });
          res.on("end", () => {
            clearTimeout(timer);
            const flat: Record<string, string | undefined> = {};
            for (const [k, v] of Object.entries(res.headers)) flat[k] = Array.isArray(v) ? v.join(", ") : v;
            resolvePromise({ status: res.statusCode ?? 0, headers: flat, body: Buffer.concat(chunks) });
          });
          res.on("error", reject);
        },
      );
      const timer = setTimeout(() => req.destroy(new FetchError(`timed out after ${timeoutMs} ms`)), timeoutMs);
      req.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      req.end();
    });
}

export const DEFAULT_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "text/calendar",
  "application/rss+xml",
  "application/atom+xml",
  "application/xml",
  "text/xml",
];

export interface SafeFetchOptions {
  transport?: Transport;
  /** Called with every URL before it is requested (first request and each redirect). Throw to block it. */
  beforeRequest?: (url: URL) => void | Promise<void>;
  maxRedirects?: number;
  timeoutMs?: number;
  maxBytes?: number;
  /** `null` accepts any content type. */
  allowedContentTypes?: string[] | null;
  now?: () => Date;
}

export interface FetchResult {
  /** Final URL after redirects. */
  url: string;
  status: number;
  contentType: string;
  text: string;
  fetchedAt: string;
}

let defaultTransport: Transport | null = null;

export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<FetchResult> {
  const {
    transport = (defaultTransport ??= createNodeTransport()),
    beforeRequest,
    maxRedirects = 3,
    timeoutMs = 15_000,
    maxBytes = 2_000_000,
    allowedContentTypes = DEFAULT_CONTENT_TYPES,
    now = () => new Date(),
  } = options;
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: allowedContentTypes ? allowedContentTypes.join(", ") : "*/*",
    "Accept-Encoding": "identity",
  };

  let current = rawUrl;
  for (let hop = 0; ; hop++) {
    const url = parseSafeUrl(current);
    await beforeRequest?.(url);
    const res = await transport(url, { timeoutMs, maxBytes, headers });

    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      if (hop >= maxRedirects) throw new FetchError(`too many redirects (more than ${maxRedirects})`, res.status);
      current = new URL(res.headers.location, url).href;
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new FetchError(`HTTP ${res.status} for ${url.href}`, res.status);
    if (res.body.length > maxBytes) throw new FetchError(`response is larger than ${maxBytes} bytes`);

    const contentTypeHeader = res.headers["content-type"] ?? "";
    const contentType = contentTypeHeader.split(";")[0].trim().toLowerCase();
    if (allowedContentTypes && !allowedContentTypes.includes(contentType)) {
      throw new FetchError(`unsupported content type "${contentType || "none"}" for ${url.href}`);
    }
    return { url: url.href, status: res.status, contentType, text: decode(res.body, contentTypeHeader), fetchedAt: now().toISOString() };
  }
}

function decode(body: Buffer, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}
