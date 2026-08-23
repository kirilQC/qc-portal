// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export const metadata: Metadata = {
  title: "QC Growth — Client Portal",
  description: "Your outbound programme: campaigns, replies, meetings booked and pipeline generated.",
  authors: [{ name: "Kiril Ivlev", url: "https://www.linkedin.com/in/kiril-ivlev/" }],
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
