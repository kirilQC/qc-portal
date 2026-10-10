// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * A client's logo for link previews (Slack fetches it with no session). Only the logo QC Command already
 * shows for that client; anything else, or no logo, is QC Growth's own mark.
 */
import { NextResponse } from "next/server";
import { SITE, previewClient } from "../../../lib/link-preview";

const CACHE = { "Cache-Control": "public, max-age=86400" };
const fallback = () => NextResponse.redirect(`${SITE}/qc-growth-logo.png`, { status: 302, headers: CACHE });

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const client = await previewClient((await context.params).slug);
  const logo = client?.logo ?? "";
  const data = logo.match(/^data:(image\/(?:png|jpe?g|gif|webp|svg\+xml));base64,(.+)$/i);
  if (data) {
    return new NextResponse(Buffer.from(data[2], "base64"), { headers: { ...CACHE, "Content-Type": data[1] } });
  }
  if (/^https:\/\//i.test(logo)) {
    const response = await fetch(logo, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    const type = response?.headers.get("content-type") ?? "";
    if (response?.ok && type.startsWith("image/")) {
      return new NextResponse(await response.arrayBuffer(), { headers: { ...CACHE, "Content-Type": type } });
    }
  }
  return fallback();
}
