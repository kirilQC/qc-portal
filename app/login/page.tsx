// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

import type { Metadata } from "next";
import LoginForm from "./LoginForm";
import { SITE, previewClient, slugFromNext } from "../lib/link-preview";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** A shared link to a client's page arrives here (no session), so this is where its preview is set. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const next = (await searchParams).next;
  const client = await previewClient(slugFromNext(typeof next === "string" ? next : ""));
  if (!client) return {};
  const title = `${client.name} · QC Growth Client Portal`;
  const description = `${client.name}'s outbound programme with QC Growth: campaigns, replies, meetings booked and pipeline generated.`;
  const image = { url: `${SITE}/api/og/${client.slug}`, alt: `${client.name} logo` };
  return {
    title,
    description,
    openGraph: { title, description, siteName: "QC Growth", images: [image] },
    twitter: { card: "summary", title, description, images: [image.url] },
  };
}

export default function LoginPage() {
  return <LoginForm />;
}
