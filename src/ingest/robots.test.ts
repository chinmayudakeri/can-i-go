import { describe, expect, it, vi } from "vitest";
import { HostThrottle, RobotsChecker, isAllowedByRobots, parseRobots } from "./robots";

describe("robots.txt rules", () => {
  it("allows everything for an empty Disallow and blocks named bots only (Devpost's file)", () => {
    const rules = parseRobots(`# comment
User-agent: *
Disallow:

User-agent: Bytespider
Disallow: /`);
    expect(isAllowedByRobots(rules, "/hackathons")).toBe(true);
    expect(isAllowedByRobots(rules, "/hackathons", "Bytespider")).toBe(false);
  });

  it("uses the longest matching rule, with Allow winning ties", () => {
    const rules = parseRobots(`User-agent: *
Disallow: /events/
Allow: /events/public
Disallow: /admin
Allow: /admin`);
    expect(isAllowedByRobots(rules, "/events/secret")).toBe(false);
    expect(isAllowedByRobots(rules, "/events/public/1")).toBe(true);
    expect(isAllowedByRobots(rules, "/admin")).toBe(true);
    expect(isAllowedByRobots(rules, "/about")).toBe(true);
  });

  it("supports * and $ patterns", () => {
    const rules = parseRobots(`User-agent: *
Disallow: /*/promo_codes/
Disallow: /*.pdf$`);
    expect(isAllowedByRobots(rules, "/events/1/promo_codes/x")).toBe(false);
    expect(isAllowedByRobots(rules, "/files/a.pdf")).toBe(false);
    expect(isAllowedByRobots(rules, "/files/a.pdf?v=1")).toBe(true);
  });

  it("prefers a group for our bot over the * group, and merges grouped user agents", () => {
    const rules = parseRobots(`User-agent: *
Disallow: /

User-agent: OtherBot
User-agent: CanIGoBot
Disallow: /private`);
    expect(isAllowedByRobots(rules, "/events")).toBe(true);
    expect(isAllowedByRobots(rules, "/private/x")).toBe(false);
    expect(isAllowedByRobots(rules, "/events", "SomeoneElse")).toBe(false);
  });
});

describe("RobotsChecker", () => {
  const url = new URL("https://example.org/events/1");

  it("fetches robots.txt once per site", async () => {
    const fetchRobots = vi.fn(async () => ({ status: 200, text: "User-agent: *\nDisallow: /events/" }));
    const checker = new RobotsChecker(fetchRobots);
    expect(await checker.check(url)).toMatchObject({ allowed: false, reason: expect.stringMatching(/disallows/) });
    expect(await checker.check(new URL("https://example.org/about"))).toEqual({ allowed: true });
    expect(fetchRobots).toHaveBeenCalledTimes(1);
    expect(fetchRobots.mock.calls[0]).toEqual([new URL("https://example.org/robots.txt")]);
  });

  it("treats a missing robots.txt (4xx) as allowed", async () => {
    expect(await new RobotsChecker(async () => ({ status: 404, text: "" })).check(url)).toEqual({ allowed: true });
  });

  it("treats a server error or network failure as disallowed", async () => {
    expect((await new RobotsChecker(async () => ({ status: 503, text: "" })).check(url)).allowed).toBe(false);
    expect((await new RobotsChecker(() => Promise.reject(new Error("ECONNRESET"))).check(url)).allowed).toBe(false);
  });
});

describe("HostThrottle", () => {
  it("waits between requests to the same host only", async () => {
    let now = 0;
    const sleep = vi.fn(async (ms: number) => {
      now += ms;
    });
    const throttle = new HostThrottle(1000, () => now, sleep);
    await throttle.wait("a.example");
    await throttle.wait("b.example");
    expect(sleep).not.toHaveBeenCalled();
    now += 200;
    await throttle.wait("a.example");
    expect(sleep).toHaveBeenCalledWith(800);
  });
});
