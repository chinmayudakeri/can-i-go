/**
 * Per-site access rules, from each site's terms of service (checked
 * 2026-10-18). robots.txt is checked separately at runtime; this table covers
 * what robots.txt doesn't: sites whose terms forbid automated access or reuse.
 * It applies to configured feeds and to `--url` alike.
 */

export type FetchPurpose = "page" | "ics-feed" | "rss-feed";

export type PolicyDecision = { allowed: true } | { allowed: false; reason: string };

interface SitePolicy {
  domains: string[];
  /** Returns null to allow, or the reason it is refused. */
  check: (url: URL, purpose: FetchPurpose) => string | null;
}

const SITE_POLICIES: SitePolicy[] = [
  {
    domains: ["devpost.com"],
    check: () =>
      "Devpost's terms (§4) forbid using automated software, scripts or robots to access, scrape, crawl or spider the site. Add the hackathon from its own website instead.",
  },
  {
    domains: ["mlh.io", "mlh.com"],
    check: () =>
      "MLH's terms allow personal, non-commercial use only and forbid republishing or displaying site content without written consent. Add the hackathon from its own website instead.",
  },
  {
    domains: ["lu.ma", "luma.com"],
    // Luma's terms: "you must not access the Service by any means other than our publicly supported interfaces".
    // iCal subscriptions ("Add iCal Subscription" on a calendar or city page) are a documented feature;
    // the URL that button gives is on api.lu.ma / api.luma.com under /ics/.
    check: (url, purpose) => {
      const isIcsUrl = (url.hostname === "api.lu.ma" || url.hostname === "api.luma.com") && url.pathname.startsWith("/ics/");
      if (purpose === "ics-feed" && isIcsUrl) return null;
      return "Luma's terms only allow its publicly supported interfaces. Use the calendar's iCal subscription URL (from \"Add iCal Subscription\") as an ics feed, not event pages.";
    },
  },
];

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function checkSitePolicy(url: URL, purpose: FetchPurpose): PolicyDecision {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  for (const policy of SITE_POLICIES) {
    if (!policy.domains.some((d) => hostMatches(host, d))) continue;
    const reason = policy.check(url, purpose);
    return reason === null ? { allowed: true } : { allowed: false, reason };
  }
  return { allowed: true };
}
