"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OpportunityCard } from "@/components/OpportunityCard";
import { StateMessage } from "@/components/StateMessage";
import { useNow } from "@/hooks/useNow";
import { useOpportunities } from "@/hooks/useOpportunities";
import { useProfile } from "@/hooks/useProfile";
import { ELIGIBILITY_LABELS } from "@/lib/eligibility";
import { DEFAULT_FILTERS, getFeed, getFilterOptions, type FeedFilters, type SortKey } from "@/lib/feed";
import { parseFeedParams, toFeedParams } from "@/lib/feedParams";
import { TYPE_LABELS } from "@/lib/format";
import type { Opportunity, StudentProfile } from "@/lib/types";

export default function DiscoverPage() {
  return (
    <Suspense fallback={<StateMessage kind="loading" title="Loading events…" />}>
      <Discover />
    </Suspense>
  );
}

function Discover() {
  const opps = useOpportunities();
  const { state: profileState } = useProfile();

  return (
    <>
      <div className="page-head">
        <h1>Discover</h1>
        <ProfileHint state={profileState} />
      </div>
      {opps.status === "loading" || profileState.status === "loading" ? (
        <StateMessage kind="loading" title="Loading events…" />
      ) : opps.status === "error" ? (
        <StateMessage kind="error" title="Couldn't load events">
          <p>{opps.error}</p>
          <button type="button" onClick={opps.retry}>
            Try again
          </button>
        </StateMessage>
      ) : opps.opportunities.length === 0 ? (
        <StateMessage kind="empty" title="No events available yet">
          <p>No source returned any events. Check back later.</p>
        </StateMessage>
      ) : (
        <Feed
          opportunities={opps.opportunities}
          profile={profileState.status === "ready" ? profileState.profile : null}
        />
      )}
    </>
  );
}

function ProfileHint({ state }: { state: ReturnType<typeof useProfile>["state"] }) {
  if (state.status === "error") {
    return (
      <p className="notice notice-warn" role="alert">
        Couldn&apos;t read your saved profile ({state.error}). Eligibility can&apos;t be checked.
      </p>
    );
  }
  if (state.status === "ready" && !state.profile) {
    return (
      <p className="notice">
        <Link href="/profile">Add your profile</Link> to check eligibility and see why events fit you.
      </p>
    );
  }
  return null;
}

/** Local text state, pushed to the URL after a short pause so typing never lags. */
function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const lastSent = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    // Only adopt URL changes we didn't make ourselves (e.g. "Reset filters").
    if (value !== lastSent.current) {
      lastSent.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => {
    if (text === lastSent.current) return;
    const id = setTimeout(() => {
      lastSent.current = text;
      onChangeRef.current(text);
    }, 250);
    return () => clearTimeout(id);
  }, [text]);

  return (
    <label className="field">
      <span>Search</span>
      <input
        type="search"
        value={text}
        placeholder="Name, organizer, topic, city…"
        onChange={(e) => setText(e.target.value)}
      />
    </label>
  );
}

function Feed({ opportunities, profile }: { opportunities: Opportunity[]; profile: StudentProfile | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const now = useNow();

  const { filters, sort } = useMemo(
    () => parseFeedParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const options = useMemo(() => getFilterOptions(opportunities), [opportunities]);
  const items = useMemo(
    () => getFeed(opportunities, profile, filters, sort, now),
    [opportunities, profile, filters, sort, now],
  );

  const update = useCallback(
    (next: Partial<FeedFilters>, nextSort: SortKey = sort) => {
      const qs = toFeedParams({ ...filters, ...next }, nextSort).toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [filters, sort, router, pathname],
  );
  const reset = () => router.replace(pathname, { scroll: false });

  // Filters start expanded on wide screens and collapsed on phones.
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (detailsRef.current) detailsRef.current.open = !window.matchMedia("(max-width: 800px)").matches;
  }, []);
  const isFiltered = toFeedParams(filters, sort).toString() !== "";

  return (
    <div className="feed-layout">
      <form
        className="filters"
        role="search"
        onSubmit={(e) => e.preventDefault()}
        aria-label="Search and filter events"
      >
        <SearchBox value={filters.query} onChange={(query) => update({ query })} />

        <label className="field">
          <span>Sort by</span>
          <select value={sort} onChange={(e) => update({}, e.target.value as SortKey)}>
            <option value="relevance">Relevance (reasons for minus against)</option>
            <option value="deadline">Application deadline</option>
            <option value="start">Event date</option>
            <option value="cost">Estimated cost</option>
          </select>
        </label>

        <details className="more-filters" ref={detailsRef}>
          <summary>Filters</summary>
          <fieldset className="field">
            <legend>Type</legend>
            {options.types.map((t) => (
              <label key={t} className="check">
                <input
                  type="checkbox"
                  checked={filters.types.includes(t)}
                  onChange={(e) =>
                    update({ types: e.target.checked ? [...filters.types, t] : filters.types.filter((x) => x !== t) })
                  }
                />
                {TYPE_LABELS[t]}
              </label>
            ))}
          </fieldset>

          <label className="field">
            <span>Topic</span>
            <select value={filters.topic ?? ""} onChange={(e) => update({ topic: e.target.value || null })}>
              <option value="">Any topic</option>
              {options.topics.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Location</span>
            <select
              value={filters.location}
              onChange={(e) => update({ location: e.target.value as FeedFilters["location"] })}
            >
              <option value="any">Anywhere</option>
              <option value="online">Can attend online</option>
              <option value="in-person">Can attend in person</option>
              {options.cities.map((c) => (
                <option key={c} value={`city:${c}`}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Eligibility</span>
            <select
              value={filters.eligibility}
              onChange={(e) => update({ eligibility: e.target.value as FeedFilters["eligibility"] })}
            >
              <option value="any">Any</option>
              {Object.entries(ELIGIBILITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Deadline</span>
            <select
              value={filters.deadline}
              onChange={(e) => update({ deadline: e.target.value as FeedFilters["deadline"] })}
            >
              <option value="hide-passed">Hide passed deadlines</option>
              <option value="only-passed">Only passed deadlines</option>
              <option value="all">Show all</option>
            </select>
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={filters.beginnerFriendlyOnly}
              onChange={(e) => update({ beginnerFriendlyOnly: e.target.checked })}
            />
            Beginner friendly only
          </label>
        </details>

        {isFiltered && (
          <button type="button" className="secondary" onClick={reset}>
            Reset filters
          </button>
        )}
      </form>

      <section aria-label="Results">
        <p className="result-count" aria-live="polite">
          {items.length} of {opportunities.length} events
        </p>
        {items.length === 0 ? (
          <StateMessage kind="empty" title="No events match these filters">
            <p>
              {filters.deadline === "hide-passed" ? "Events with passed deadlines are hidden. " : ""}
              Try removing a filter.
            </p>
            <button type="button" onClick={() => update(DEFAULT_FILTERS)}>
              Clear filters
            </button>
          </StateMessage>
        ) : (
          <div className="cards">
            {items.map((item) => (
              <OpportunityCard key={item.opportunity.id} item={item} now={now} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
