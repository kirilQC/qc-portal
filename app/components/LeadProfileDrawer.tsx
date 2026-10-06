// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { useEffect, useState } from "react";
import "../(portal)/[client]/database/database.css";
import { SkeletonRows } from "./PageSkeleton";

/**
 * A lead's full profile, as a drawer over the page: the enrichment record (work history, education,
 * company, skills) and every conversation with them.
 *
 * Shared by the lead database and the inbox's "View full profile", so a person looks the same wherever
 * they are opened. Takes whatever summary the caller already holds (at least an id and a name) and fetches
 * the heavy record itself; the summary fills the header and any field the record does not have.
 */
export type LeadSummary = {
  id: string; name: string; role: string; company: string;
  linkedinId: string | null; profileUrl: string | null; photoUrl: string | null;
  email: string | null; location: string | null; headline: string | null; industry: string | null;
  campaignNames: string[]; senderNames: string[];
  icpScore: number | null; icpReason: string | null;
  enrichmentStatus: string | null; enriched: boolean;
  conversationCount: number; replyCount: number;
  lastReplyAt: string | null; createdAt: string;
};

type Role = { title: string; start: string; end: string; current: boolean; location: string; description: string };
type Employer = { company: string; logo: string; url: string | null; start: string; end: string; roles: Role[] };
type School = { school: string; degree: string; start: string; end: string };
type Thread = {
  id: string; score: number; tier: string; reason: string; lastMessageAt: string | null;
  messages: { id: string; direction: string; body: string; sentAt: string; authorName: string }[];
};
type LeadDetail = {
  id: string; name: string; role: string; company: string;
  profileUrl: string | null; linkedinId: string | null; photoUrl: string | null; companyPhotoUrl: string | null;
  createdAt: string; email: string | null; location: string | null; headline: string | null;
  industry: string | null; summary: string | null; connections: number | null; followers: number | null;
  department: string[]; enrichedAt: string | null;
  companyProfile: {
    name: string | null; website: string | null; industry: string | null; size: string | null;
    founded: string | null; location: string | null; description: string | null; linkedin: string | null; logo: string | null;
  };
  experience: Employer[]; education: School[];
  skills: string[]; languages: string[]; certifications: string[]; tags: string[];
  icpScore: number | null; icpReason: string | null; enrichmentStatus: string | null; enriched: boolean;
  campaignNames: string[]; senderNames: string[];
};


function dateParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "—", time: "" };
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return { date: "—", time: "" };
  return {
    date: value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    time: value.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  };
}

/** Logos are decoration: a dead link (enrichment CDN URLs expire) is hidden rather than drawn broken. */
const hideBroken = (event: React.SyntheticEvent<HTMLImageElement>) => {
  event.currentTarget.style.display = "none";
};

/** A lead photo that falls back to initials when the URL is dead (LinkedIn photo links expire). */
function Avatar({ src, name }: { src?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <>{initials(name)}</>;
  return <img src={src} alt="" onError={() => setFailed(true)} />;
}

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";


export default function LeadProfileDrawer({ lead, clientSlug, onClose }: {
  lead: Partial<LeadSummary> & { id: string; name: string };
  clientSlug: string | null;
  onClose: () => void;
}) {
  const selected = {
    role: "", company: "", linkedinId: null, profileUrl: null, photoUrl: null, email: null, location: null,
    headline: null, industry: null, campaignNames: [], senderNames: [], icpScore: null, icpReason: null,
    enrichmentStatus: null, enriched: false, conversationCount: 0, replyCount: 0, lastReplyAt: null, createdAt: "",
    ...lead,
  } as LeadSummary;
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [detailTab, setDetailTab] = useState<"overview" | "activity">("overview");
  const [detailLoading, setDetailLoading] = useState(true);
  const setSelected = (value: null) => { if (value === null) onClose(); };

  // A dialog closes on Escape.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The heavy half of a lead is fetched only when it is opened — see the note in the detail route.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const query = clientSlug ? `?client=${encodeURIComponent(clientSlug)}` : "";
        const response = await fetch(`/api/leads/${encodeURIComponent(lead.id)}${query}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (live && response.ok) { setDetail(payload.lead ?? null); setThreads(payload.threads ?? []); }
      } catch {
        /* the drawer falls back to the summary it was given */
      } finally {
        if (live) setDetailLoading(false);
      }
    })();
    return () => { live = false; };
  }, [lead.id, clientSlug]);

  return (
        <div className="db-drawer-backdrop">
          {/* A real button rather than a div with a click handler, so closing the drawer by clicking
              away is reachable from the keyboard and announced as the control it is. */}
          <button className="db-drawer-scrim" aria-label="Close lead details" onClick={() => setSelected(null)} />
          <aside className="db-drawer" role="dialog" aria-label={`Details for ${selected.name}`}>
            <div className="db-drawer-head">
              <span className="db-drawer-avatar">
                <Avatar key={selected.id} src={selected.photoUrl} name={selected.name} />
              </span>
              <div>
                <h2>{selected.name}</h2>
                <p>{[selected.role, selected.company].filter(Boolean).join(" at ") || "No title or company"}</p>
              </div>
              <button className="db-drawer-close" onClick={() => setSelected(null)} aria-label="Close">×</button>
            </div>
            <nav className="db-tabs">
              <button className={detailTab === "overview" ? "active" : ""} onClick={() => setDetailTab("overview")}>Overview</button>
              <button className={detailTab === "activity" ? "active" : ""} onClick={() => setDetailTab("activity")}>
                Conversations{threads.length ? ` (${threads.length})` : ""}
              </button>
            </nav>

            <div className="db-drawer-body">
              {detailLoading && !detail && <SkeletonRows rows={4} />}

              {detailTab === "overview" && (
                <>
                  <div className="db-fields">
                    <Field label="Email" value={detail?.email ?? selected.email} />
                    <Field label="LinkedIn" value={detail?.profileUrl ?? selected.profileUrl} link={detail?.profileUrl ?? selected.profileUrl} />
                    <Field label="Location" value={detail?.location ?? selected.location} />
                    <Field label="Industry" value={detail?.industry ?? selected.industry} />
                    <Field label="Connections" value={detail?.connections == null ? null : detail.connections.toLocaleString()} />
                    <Field label="Followers" value={detail?.followers == null ? null : detail.followers.toLocaleString()} />
                    <Field label="Seniority and department" value={detail?.department?.length ? detail.department.join(" · ") : null} wide />
                    <Field label="Headline" value={detail?.headline ?? selected.headline} wide />
                    {detail?.summary && <Field label="About" value={detail.summary} wide />}
                  </div>

                  {detail?.companyProfile?.name && (
                    <Section title="Current company">
                      <div className="db-company">
                        {detail.companyProfile.logo && <img className="db-company-logo" src={detail.companyProfile.logo} alt="" onError={hideBroken} />}
                        <div className="db-fields">
                          <Field label="Company" value={detail.companyProfile.name} />
                          <Field label="Website" value={detail.companyProfile.website} link={detail.companyProfile.website} />
                          <Field label="Industry" value={detail.companyProfile.industry} />
                          <Field label="Size" value={detail.companyProfile.size} />
                          <Field label="Founded" value={detail.companyProfile.founded} />
                          <Field label="Headquarters" value={detail.companyProfile.location} />
                          <Field label="Company LinkedIn" value={detail.companyProfile.linkedin} link={detail.companyProfile.linkedin} />
                          {detail.companyProfile.description && <Field label="What they do" value={detail.companyProfile.description} wide />}
                        </div>
                      </div>
                    </Section>
                  )}

                  {detail && detail.experience.length > 0 && (
                    <Section title="Experience">
                      {/* Grouped by employer, because four titles at one company over six years is one
                          story; four flat rows would read as four jobs. */}
                      <div className="db-employers">
                        {detail.experience.map((employer, index) => (
                          <article key={`${employer.company}-${index}`}>
                            <header>
                              {employer.logo && <img src={employer.logo} alt="" onError={hideBroken} />}
                              <div>
                                {employer.url ? (
                                  <a href={employer.url} target="_blank" rel="noreferrer">{employer.company} ↗</a>
                                ) : (
                                  <strong>{employer.company}</strong>
                                )}
                                <span>{range(employer.start, employer.end, !employer.end)}</span>
                              </div>
                            </header>
                            {employer.roles.map((role, roleIndex) => (
                              <div className="db-role" key={`${role.title}-${roleIndex}`}>
                                <h4>{role.title}</h4>
                                <p>{range(role.start, role.end, role.current)}{role.location ? ` · ${role.location}` : ""}</p>
                                {role.description && <p className="db-role-desc">{role.description}</p>}
                              </div>
                            ))}
                          </article>
                        ))}
                      </div>
                    </Section>
                  )}

                  {detail && detail.education.length > 0 && (
                    <Section title="Education">
                      <ol className="db-timeline">
                        {detail.education.map((entry, index) => (
                          <li key={`${entry.school}-${index}`}>
                            <strong>{entry.school}</strong>
                            {entry.degree && <span className="db-timeline-org">{entry.degree}</span>}
                            <span className="db-timeline-when">{range(entry.start, entry.end, false)}</span>
                          </li>
                        ))}
                      </ol>
                    </Section>
                  )}

                  {detail && detail.skills.length > 0 && (
                    <Section title="Skills">
                      <div className="db-chips">{detail.skills.map((skill) => <span key={skill} className="db-chip">{skill}</span>)}</div>
                    </Section>
                  )}

                  {detail && detail.languages.length > 0 && (
                    <Section title="Languages">
                      <div className="db-chips">{detail.languages.map((language) => <span key={language} className="db-chip">{language}</span>)}</div>
                    </Section>
                  )}

                  {detail && detail.certifications.length > 0 && (
                    <Section title="Certifications">
                      <div className="db-chips">{detail.certifications.map((item) => <span key={item} className="db-chip">{item}</span>)}</div>
                    </Section>
                  )}

                  {detail && detail.tags.length > 0 && (
                    <Section title="HeyReach tags">
                      <div className="db-chips">{detail.tags.map((tag) => <span key={tag} className="db-chip">{tag}</span>)}</div>
                    </Section>
                  )}

                  <Section title="In this programme">
                    <div className="db-fields">
                      <Field label="Campaigns" value={(detail?.campaignNames ?? selected.campaignNames).join("; ") || null} wide />
                      <Field label="Senders" value={(detail?.senderNames ?? selected.senderNames).join("; ") || null} wide />
                      <Field label="ICP score" value={(detail?.icpScore ?? selected.icpScore) == null ? null : String(detail?.icpScore ?? selected.icpScore)} />
                      <Field label="Enrichment" value={detail?.enrichmentStatus ?? selected.enrichmentStatus ?? (selected.enriched ? "enriched" : null)} />
                      <Field label="Conversations" value={String(selected.conversationCount)} />
                      <Field label="Replies" value={String(selected.replyCount)} />
                      <Field label="Last reply" value={selected.lastReplyAt ? dateParts(selected.lastReplyAt).date : null} />
                      <Field label="Added" value={dateParts(selected.createdAt).date} />
                      <Field label="Last enriched" value={detail?.enrichedAt ? dateParts(detail.enrichedAt).date : null} />
                    </div>
                  </Section>

                  {(detail?.icpReason ?? selected.icpReason) && (
                    <div className="db-reason">
                      <small>WHY THIS ICP SCORE</small>
                      <p>{detail?.icpReason ?? selected.icpReason}</p>
                    </div>
                  )}
                </>
              )}

              {detailTab === "activity" && (
                threads.length === 0 ? (
                  detailLoading ? <SkeletonRows rows={3} /> : <p className="empty">No conversations recorded.</p>
                ) : (
                  threads.map((thread) => (
                    <div key={thread.id} className="db-thread">
                      <div className="db-thread-head">
                        <span>{thread.lastMessageAt ? dateParts(thread.lastMessageAt).date : "Conversation"}</span>
                        <span className="db-thread-meta">{thread.messages.length} message{thread.messages.length === 1 ? "" : "s"}</span>
                      </div>
                      {thread.reason && <p className="db-thread-reason">{thread.reason}</p>}
                      <div className="db-thread-body">
                        {thread.messages.map((message) => (
                          <div key={message.id} className={`bubble ${message.direction === "outbound" ? "outbound" : "inbound"}`}>
                            <small className="message-author">{message.authorName}</small>
                            <p>{message.body}</p>
                            <time>{dateParts(message.sentAt).date} · {dateParts(message.sentAt).time}</time>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )
              )}
            </div>
          </aside>
        </div>
  );
}

/** A titled block in the drawer. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="db-section">
      <h3 className="db-section-title">{title}</h3>
      {children}
    </section>
  );
}

/** "Jan 2021 — Present". Formatted in UTC for the reason given in shared/enrichment.mjs. */
function range(start: string, end: string, current: boolean): string {
  const short = (iso: string) => {
    if (!iso) return "";
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return String(iso).slice(0, 7);
    return parsed.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  };
  const from = short(start);
  const to = current && !end ? "Present" : short(end);
  if (!from && !to) return "";
  if (!from) return to;
  if (!to) return from;
  return `${from} — ${to}`;
}

function Field({ label, value, link, wide }: { label: string; value: string | null; link?: string | null; wide?: boolean }) {
  return (
    <div className={`db-field ${wide ? "wide" : ""}`}>
      <span className="db-field-label">{label}</span>
      <span className="db-field-value">
        {value ? (
          link ? <a href={link} target="_blank" rel="noreferrer">{value}</a> : value
        ) : (
          <em>Not recorded</em>
        )}
      </span>
    </div>
  );
}

