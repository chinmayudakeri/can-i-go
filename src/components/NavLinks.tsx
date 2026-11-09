"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Discover" },
  { href: "/shortlist", label: "Shortlist" },
  { href: "/calendar", label: "Calendar" },
  { href: "/profile", label: "Profile" },
  { href: "/privacy", label: "Privacy" },
];

/** Main navigation; the current page is marked with aria-current for screen readers. */
export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main">
      {LINKS.map(({ href, label }) => {
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
