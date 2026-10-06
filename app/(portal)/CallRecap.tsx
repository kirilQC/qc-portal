// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loads on mount and when the client changes; the
   setState calls sit inside an async callback rather than the effect body. */

import { useEffect, useState } from "react";
import Link from "next/link";
// The same parser the Weekly calls page uses, so the recap here and the full page always agree.
import { parseCall } from "../../shared/calls.mjs";

/**
 * The last weekly call, in brief, beside the reply calendar.
 *
 * Reads the newest recap from the client's Weekly calls folder (the same files the Weekly calls tab
 * shows) and keeps only what someone wants before the next call: when it was, the summary, and the
 * action items with their owners. Everything else is one click away on the full page.
 */
type Item = { owner: string | null; text: string; sub: string | null };
type Section = { key: string; label: string; items: Item[] };
type Call = { title: string; date: string | null; durationMinutes: number | null; intro: string; sections: Section[]; actionCount: number };
type Doc = { path: string; date: string | null; title: string };

const longDate = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }) : "";

export default function CallRecap({ clientSlug }: { clientSlug: string | null }) {
  const [state, setState] = useState<{ status: "loading" | "none" | "ready"; call?: Call; doc?: Doc }>({ status: "loading" });

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    void (async () => {
      try {
        const query = new URLSearchParams({ folder: "calls" });
        if (clientSlug) query.set("client", clientSlug);
        const list = await fetch(`/api/brain-docs?${query.toString()}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
        const doc: Doc | undefined = list?.ok ? list.docs?.[0] : undefined;
        if (!doc) { if (live) setState({ status: "none" }); return; }
        query.set("path", doc.path);
        const file = await fetch(`/api/brain-docs?${query.toString()}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
        if (!live) return;
        if (!file?.ok) { setState({ status: "none" }); return; }
        setState({ status: "ready", call: parseCall(file.markdown ?? "") as Call, doc });
      } catch {
        if (live) setState({ status: "none" });
      }
    })();
    return () => { live = false; };
  }, [clientSlug]);

  const callsHref = `${clientSlug ? `/${clientSlug}` : ""}/calls`;

  return (
    <section className="panel ov-recap">
      <div className="panel-head">
        <h2>Last weekly call</h2>
        {state.status === "ready" && <Link href={callsHref} className="ov-recap-link">Full recap →</Link>}
      </div>
      <div className="ov-recap-body">
        {state.status === "loading" && (
          <div className="ov-recap-skel" aria-hidden="true"><i /><i /><i /><i /></div>
        )}
        {state.status === "none" && <p className="empty">No weekly call recorded yet.</p>}
        {state.status === "ready" && state.call && (() => {
          const call = state.call;
          const actions = call.sections.find((section) => section.key === "actions")?.items ?? [];
          const next = call.sections.find((section) => section.key === "next")?.items ?? [];
          const date = call.date ?? state.doc?.date ?? null;
          return (
            <>
              <div className="ov-recap-meta">
                <span>{longDate(date)}</span>
                {call.durationMinutes ? <span>{call.durationMinutes} min</span> : null}
                {call.actionCount > 0 && <span className="ov-recap-count">{call.actionCount} action item{call.actionCount === 1 ? "" : "s"}</span>}
              </div>
              {call.intro && <p className="ov-recap-intro">{call.intro}</p>}
              {actions.length > 0 && (
                <div className="ov-recap-list">
                  <span className="ov-recap-label">Action items</span>
                  <ul>
                    {actions.slice(0, 4).map((item, i) => (
                      <li key={i}>
                        {item.owner && <b className="ov-recap-owner">{item.owner}</b>}
                        <span>{item.text}</span>
                      </li>
                    ))}
                  </ul>
                  {actions.length > 4 && <Link href={callsHref} className="ov-recap-more">+{actions.length - 4} more</Link>}
                </div>
              )}
              {actions.length === 0 && next.length > 0 && (
                <div className="ov-recap-list">
                  <span className="ov-recap-label">Next steps</span>
                  <ul>{next.slice(0, 4).map((item, i) => <li key={i}><span>{item.text}</span></li>)}</ul>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </section>
  );
}
