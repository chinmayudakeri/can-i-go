"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCalendarEnabled } from "@/hooks/useCalendarEnabled";

const LINKS = [
  { href: "/", label: "Discover" },
  { href: "/shortlist", label: "Shortlist" },
  { href: "/calendar", label: "Calendar" },
  { href: "/profile", label: "Profile" },
  { href: "/privacy", label: "Privacy" },
];

/** Main navigation; the current page is marked with aria-current. Calendar only shows while "Use my calendar" is on. */
export function NavLinks() {
  const pathname = usePathname();
  const { enabled } = useCalendarEnabled();
  return (
    <nav aria-label="Main">
      {LINKS.filter((l) => enabled || l.href !== "/calendar").map(({ href, label }) => {
        const current = href === "/" ? pathname === "/" || pathname.startsWith("/events") : pathname.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={current ? "page" : undefined}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
