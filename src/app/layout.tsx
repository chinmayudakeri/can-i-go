import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import realListings from "@data/real/listings.json";
import { NavLinks } from "@/components/NavLinks";
import "./globals.css";

export const metadata: Metadata = {
  title: "Can I Go?",
  description: "Find student events and check whether you can actually go.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <header className="site-header">
          <Link href="/" className="brand">
            Can I Go?
          </Link>
          <NavLinks />
        </header>
        <div className="demo-banner" role="note">
          {realListings.length > 0
            ? "Events marked DEMO are fictional. Real listings show their source and when they were last verified."
            : "Demo mode: every event shown is fictional."}{" "}
          Your calendar stays in this browser.
        </div>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
