// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SITE } from "./lib/link-preview";

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export const metadata: Metadata = {
  title: "QC Growth — Client Portal",
  description: "Your outbound programme: campaigns, replies, meetings booked and pipeline generated.",
  authors: [{ name: "Kiril Ivlev", url: "https://www.linkedin.com/in/kiril-ivlev/" }],
  // Link previews (Slack and the like): QC Growth's mark unless a page names a client (see app/login/page.tsx).
  metadataBase: new URL(SITE),
  openGraph: {
    title: "QC Growth — Client Portal",
    description: "Your outbound programme: campaigns, replies, meetings booked and pipeline generated.",
    siteName: "QC Growth",
    images: [{ url: "/qc-growth-logo.png", width: 1024, height: 1024, alt: "QC Growth" }],
  },
  twitter: { card: "summary", images: ["/qc-growth-logo.png"] },
  // A client portal has nothing to gain from being indexed, and something to lose.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
