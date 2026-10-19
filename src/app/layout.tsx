import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
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
          <nav aria-label="Main">
            <Link href="/">Discover</Link>
            <Link href="/profile">Profile</Link>
          </nav>
        </header>
        <div className="demo-banner" role="note">
          Demo mode: every event shown is fictional. Calendar and AI checks are not connected yet.
        </div>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
