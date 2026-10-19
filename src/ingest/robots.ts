import { defaultSleep } from "./backoff";
import { FetchError, USER_AGENT_TOKEN, safeFetch } from "./safeUrl";

/**
 * robots.txt support following RFC 9309: groups by user agent, longest
 * matching rule wins, Allow wins ties, `*` and `$` patterns. We obey the
 * group for "CanIGoBot" if there is one, otherwise the `*` group.
 */

interface Rule {
  allow: boolean;
  path: string;
}
interface Group {
  agents: string[];
  rules: Rule[];
}
export interface RobotsRules {
  groups: Group[];
}

const MAX_ROBOTS_BYTES = 500 * 1024;

export function parseRobots(text: string): RobotsRules {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.slice(0, MAX_ROBOTS_BYTES).split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      // An empty Disallow means "allow everything" and adds no rule.
      if (current && value) current.rules.push({ allow: key === "allow", path: value });
    } else {
      lastWasAgent = false;
    }
  }
  return { groups };
}

function ruleMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${regex}${anchored ? "$" : ""}`).test(path);
}

/** `path` is the URL path plus query, e.g. "/events?page=2". */
export function isAllowedByRobots(rules: RobotsRules, path: string, agent: string = USER_AGENT_TOKEN): boolean {
  if (path === "/robots.txt") return true;
  const token = agent.toLowerCase();
  let groups = rules.groups.filter((g) => g.agents.includes(token));
  if (!groups.length) groups = rules.groups.filter((g) => g.agents.includes("*"));
  let best: Rule | null = null;
  for (const rule of groups.flatMap((g) => g.rules)) {
    if (!ruleMatches(rule.path, path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return best?.allow ?? true;
}

export type RobotsFetcher = (robotsUrl: URL) => Promise<{ status: number; text: string }>;

/** Fetches robots.txt through `safeFetch`, reporting the status instead of throwing on 4xx/5xx. */
export const defaultRobotsFetcher: RobotsFetcher = async (robotsUrl) => {
  try {
    const res = await safeFetch(robotsUrl.href, { allowedContentTypes: null, maxBytes: MAX_ROBOTS_BYTES, maxRedirects: 5 });
    return { status: res.status, text: res.text };
  } catch (err) {
    if (err instanceof FetchError && err.status !== undefined) return { status: err.status, text: "" };
    throw err;
  }
};

export type RobotsDecision = { allowed: true } | { allowed: false; reason: string };

/** Checks URLs against their site's robots.txt, fetching each one once per run. */
export class RobotsChecker {
  private cache = new Map<string, Promise<RobotsRules | "allow-all" | "disallow-all">>();

  constructor(private readonly fetchRobots: RobotsFetcher = defaultRobotsFetcher) {}

  async check(url: URL): Promise<RobotsDecision> {
    let entry = this.cache.get(url.origin);
    if (!entry) {
      entry = this.load(url.origin);
      this.cache.set(url.origin, entry);
    }
    const rules = await entry;
    if (rules === "allow-all") return { allowed: true };
    if (rules === "disallow-all") {
      return { allowed: false, reason: `${url.origin}/robots.txt could not be read, so we treat the site as off limits` };
    }
    return isAllowedByRobots(rules, url.pathname + url.search)
      ? { allowed: true }
      : { allowed: false, reason: `${url.origin}/robots.txt disallows ${url.pathname}` };
  }

  private async load(origin: string): Promise<RobotsRules | "allow-all" | "disallow-all"> {
    try {
      const { status, text } = await this.fetchRobots(new URL("/robots.txt", origin));
      if (status >= 200 && status < 300) return parseRobots(text);
      // RFC 9309: "unavailable" (4xx) means no restrictions; "unreachable" (5xx) means assume full disallow.
      if (status >= 400 && status < 500) return "allow-all";
      return "disallow-all";
    } catch {
      return "disallow-all";
    }
  }
}

/** Keeps at least `minIntervalMs` between requests to the same host. */
export class HostThrottle {
  private last = new Map<string, number>();

  constructor(
    private readonly minIntervalMs = 1_000,
    private readonly clock: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  async wait(host: string): Promise<void> {
    const now = this.clock();
    const next = (this.last.get(host) ?? -Infinity) + this.minIntervalMs;
    if (next > now) await this.sleep(next - now);
    this.last.set(host, Math.max(now, next));
  }
}
