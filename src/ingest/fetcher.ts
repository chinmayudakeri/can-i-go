import { checkSitePolicy, type FetchPurpose } from "./policy";
import { HostThrottle, RobotsChecker } from "./robots";
import { safeFetch, type FetchResult, type Transport } from "./safeUrl";

/** Refused by a site's terms (policy table) or its robots.txt. */
export class BlockedError extends Error {}

export type GuardedFetch = (url: string, purpose: FetchPurpose) => Promise<FetchResult>;

export interface GuardedFetchDeps {
  transport?: Transport;
  robots?: RobotsChecker;
  throttle?: HostThrottle;
}

/**
 * The only way adapters fetch anything. On every request, including each
 * redirect hop: URL safety (safeFetch), then the site policy table, then
 * robots.txt, then per-host throttling.
 */
export function createGuardedFetch(deps: GuardedFetchDeps = {}): GuardedFetch {
  const robots = deps.robots ?? new RobotsChecker();
  const throttle = deps.throttle ?? new HostThrottle();
  return (url, purpose) =>
    safeFetch(url, {
      transport: deps.transport,
      beforeRequest: async (u) => {
        const policy = checkSitePolicy(u, purpose);
        if (!policy.allowed) throw new BlockedError(`${u.hostname}: ${policy.reason}`);
        const robotsDecision = await robots.check(u);
        if (!robotsDecision.allowed) throw new BlockedError(robotsDecision.reason);
        await throttle.wait(u.host);
      },
    });
}
