// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import "./qc-lead.css";
import { activeTimeZone } from "./Appearance";

/**
 * A lead's full profile, as QC Command shows it: the same drawer, the same sections, the same markup and
 * the same styles (qc-lead.css is QC Command's own stylesheet, scoped to this drawer).
 *
 * Overview: contact information, professional profile, current company, experience and education.
 * Activity: every conversation with this client, campaign and sentiment on top, the thread underneath.
 *
 * What QC Command has and this deliberately does not: the "Clients" field (a client never sees the
 * names of QC's other clients), the phone "Enrich" button (it spends credits), and the delete / block
 * danger zone (staff-only actions, made in QC Command).
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
  id: string; lastMessageAt: string | null; campaign: string | null; sender: string | null; sentiment: string | null;
  messages: { id: string; direction: string; body: string; sentAt: string; authorName: string }[];
};
type LeadDetail = {
  id: string; name: string; role: string; company: string;
  profileUrl: string | null; photoUrl: string | null;
  createdAt: string; email: string | null; location: string | null; headline: string | null;
  industry: string | null; summary: string | null; connections: number | null; followers: number | null;
  department: string[]; enrichedAt: string | null; phone?: string | null;
  companyProfile: {
    name: string | null; website: string | null; industry: string | null; size: string | null;
    founded: string | null; location: string | null; description: string | null; linkedin: string | null; logo: string | null;
  };
  experience: Employer[]; education: School[]; tags: string[];
  enriched: boolean; campaignNames: string[]; senderNames: string[];
};

// ── QC Command's formatting, unchanged ────────────────────────────────────────────────────────────
const display = (value: unknown) => (value == null || value === "" ? "—" : String(value));
const when = (value: unknown) => (value ? new Date(String(value)).toLocaleString("en-US", { timeZone: activeTimeZone() }) : "—");
const humanize = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const monthYear = (value: string) => {
  if (!value) return "Present";
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
};
const durationBetween = (startValue: string, endValue: string) => {
  const start = new Date(`${startValue.slice(0, 10)}T00:00:00Z`);
  const end = endValue ? new Date(`${endValue.slice(0, 10)}T00:00:00Z`) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  const months = Math.max(0, (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth());
  const years = Math.floor(months / 12), remainder = months % 12;
  return [years ? `${years} yr${years === 1 ? "" : "s"}` : "", remainder ? `${remainder} mo${remainder === 1 ? "" : "s"}` : ""].filter(Boolean).join(" ") || "Less than 1 mo";
};
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";

/** A photo that falls back to initials when the link is dead (LinkedIn photo URLs expire). */
function PhotoOr({ src, fallback }: { src?: string | null; fallback: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <>{fallback}</>;
  return <img src={src} alt="" onError={() => setFailed(true)} />;
}

function ReadableField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <strong className="database-field-label">{label}</strong>
      <span className="database-field-value">{value}</span>
    </div>
  );
}

function LinkField({ label, href, text }: { label: string; href: string | null; text: string }) {
  return (
    <div>
      <strong className="database-field-label">{label}</strong>
      {href ? <a className="database-field-value" href={href} target="_blank" rel="noreferrer">{text}</a> : <span className="database-field-value">—</span>}
    </div>
  );
}

export default function LeadProfileDrawer({ lead, clientSlug, onClose }: {
  lead: Partial<LeadSummary> & { id: string; name: string };
  clientSlug: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "activity">("overview");

  // Escape closes the drawer, as it does in QC Command.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const query = clientSlug ? `?client=${encodeURIComponent(clientSlug)}` : "";
        const response = await fetch(`/api/leads/${encodeURIComponent(lead.id)}${query}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (live && response.ok) { setDetail(payload.lead ?? null); setThreads(payload.threads ?? []); }
      } catch {
        /* the header still shows who this is; the body says nothing loaded */
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [lead.id, clientSlug]);

  const name = detail?.name || lead.name;
  const photo = detail?.photoUrl ?? lead.photoUrl ?? null;

  // Rendered on <body>, outside the page's scaled scroll area, so it is drawn at QC Command's own size.
  return createPortal(
    // The backdrop's click is the pointer twin of Escape, as in QC Command.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="qc-lead database-drawer-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="database-drawer" aria-label="Lead details">
        <div className="database-drawer-head">
          <div>
            <i><PhotoOr key={photo ?? ""} src={photo} fallback={initials(name)} /></i>
            <span><h2>{name || "Loading…"}</h2></span>
          </div>
          <button onClick={onClose} aria-label="Close lead details">×</button>
        </div>
        <nav className="database-tabs">
          {(["overview", "activity"] as const).map((key) => (
            <button className={tab === key ? "active" : ""} key={key} onClick={() => setTab(key)}>
              {key[0].toUpperCase() + key.slice(1)}
            </button>
          ))}
        </nav>
        <div className="database-drawer-body">
          {loading ? (
            <div className="database-skeleton" aria-label="Loading"><i /><i /><i /><i /><i /></div>
          ) : !detail ? (
            <p className="empty-state">This lead did not load. Close and try again.</p>
          ) : tab === "overview" ? (
            <LeadOverview detail={detail} />
          ) : (
            <LeadActivity detail={detail} threads={threads} />
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function LeadOverview({ detail }: { detail: LeadDetail }) {
  const company = detail.companyProfile;
  const companyName = company.name || detail.company;
  const network = [
    detail.followers != null ? `${detail.followers.toLocaleString()} followers` : "",
    detail.connections != null ? `${detail.connections.toLocaleString()} connections` : "",
  ].filter(Boolean);
  const contactFields: [string, string][] = [
    ["Full name", display(detail.name)],
    ["Current role", display(detail.role)],
    ["Company", display(companyName)],
    ["Email", display(detail.email)],
    ["Location", display(detail.location)],
    ["Industry", display(detail.industry)],
    ["Campaigns", display(detail.campaignNames.join("; "))],
    ["Campaign count", display(detail.campaignNames.length)],
    ["Senders", display(detail.senderNames.join("; "))],
    ["First reply stored", when(detail.createdAt)],
    ["Last enriched", when(detail.enrichedAt)],
  ];
  const hasCompany = Boolean(company.name || company.industry || company.size || company.description || company.website || company.linkedin);
  const currentName = (companyName || "").toLowerCase();
  const education = detail.education.map((school) => [school.school, school.degree].filter(Boolean).join(" · "));

  return (
    <div className="database-overview">
      <section>
        <h3>Contact information</h3>
        <div className="database-field-grid">
          {contactFields.map(([label, value]) => <ReadableField label={label} value={value} key={label} />)}
          <LinkField label="LinkedIn profile" href={detail.profileUrl} text="Open LinkedIn ↗" />
          <LinkField label="Company website" href={company.website} text="Open website ↗" />
          <LinkField label="Company LinkedIn page" href={company.linkedin} text="Open company on LinkedIn ↗" />
          <div>
            <strong className="database-field-label">Phone number</strong>
            <div className="database-phone-field">
              {detail.phone
                ? <a className="database-phone-value" href={`tel:${detail.phone.replace(/[^\d+]/g, "")}`}>{detail.phone}</a>
                : <span className="database-field-value">—</span>}
            </div>
          </div>
        </div>
        {detail.tags.length > 0 && (
          <div className="database-readable-group">
            <small>HeyReach tags</small>
            <div className="database-tag-list">{detail.tags.map((tag) => <span key={tag}>{humanize(tag)}</span>)}</div>
          </div>
        )}
      </section>

      {detail.enriched && (
        <section>
          <h3>Professional profile</h3>
          <div className="database-field-grid">
            <ReadableField label="Headline" value={display(detail.headline)} />
            <ReadableField label="Seniority and department" value={detail.department.map(humanize).join(" · ") || "—"} />
            <ReadableField label="Network" value={network.join(" · ") || "—"} />
          </div>
          <div className="database-about">
            <small>About</small>
            <p>{display(detail.summary)}</p>
          </div>
        </section>
      )}

      {hasCompany && (
        <section>
          <h3>Current company</h3>
          <div className="database-company-card">
            <div className="database-company-heading">
              {company.logo && <img src={company.logo} alt={`${companyName || "Company"} logo`} />}
              <div>
                {company.linkedin || company.website ? (
                  <a href={company.linkedin || company.website || ""} target="_blank" rel="noreferrer">{companyName || "Company"} ↗</a>
                ) : (
                  <strong>{companyName || "Company"}</strong>
                )}
                {company.industry && <span>{company.industry}</span>}
              </div>
            </div>
            <div className="database-field-grid">
              <ReadableField label="Company size" value={company.size ? company.size.replace("–", " to ") : "—"} />
              <ReadableField label="Founded" value={display(company.founded)} />
              <ReadableField label="Headquarters" value={display(company.location)} />
              <LinkField label="Website" href={company.website} text="Visit website ↗" />
            </div>
            {company.description && <p className="database-company-description">{company.description}</p>}
          </div>
        </section>
      )}

      {detail.experience.length > 0 && (
        <section>
          <h3>Experience</h3>
          <div className="database-experience-list">
            {detail.experience.map((group, index) => {
              const isCurrent = Boolean(currentName && group.company.toLowerCase() === currentName);
              const destination = group.url || (isCurrent ? company.website : null);
              return (
                <article key={`${group.company}-${index}`}>
                  <header>
                    {group.logo && <img src={group.logo} alt="" />}
                    <div>
                      <strong>{group.company}</strong>
                      {isCurrent && company.industry && <span>{company.industry}</span>}
                    </div>
                    {destination && <a className="database-company-link" href={destination} target="_blank" rel="noreferrer">View company ↗</a>}
                  </header>
                  {group.roles.length ? group.roles.map((role, roleIndex) => (
                    <div className="database-role" key={`${role.title}-${roleIndex}`}>
                      <h4>{display(role.title)}</h4>
                      <p className="database-role-dates">
                        {monthYear(role.start)} to {monthYear(role.end)}{role.start ? ` · ${durationBetween(role.start, role.end)}` : ""}
                      </p>
                    </div>
                  )) : (
                    <div className="database-role">
                      <p className="database-role-dates">
                        {monthYear(group.start)} to {monthYear(group.end)}{group.start ? ` · ${durationBetween(group.start, group.end)}` : ""}
                      </p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {education.length > 0 && (
        <section>
          <h3>Education</h3>
          <div className="database-readable-group">
            <small>Education history</small>
            <ul>{education.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
          </div>
        </section>
      )}
    </div>
  );
}

function LeadActivity({ detail, threads }: { detail: LeadDetail; threads: Thread[] }) {
  const leadName = display(detail.name);
  return (
    <div className="database-activity">
      {threads.map((thread) => {
        // Collapse a message stored twice under opposite directions a few seconds apart, as QC Command does.
        const messages = [...thread.messages]
          .sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt))
          .filter((message, index, all) => index === all.findIndex((candidate) =>
            candidate.body.trim() === message.body.trim() && Math.abs(Date.parse(candidate.sentAt) - Date.parse(message.sentAt)) < 5 * 60_000));
        const latestInboundId = [...messages].reverse().find((message) => message.direction !== "outbound")?.id;
        return (
          <section className="database-conversation-history" key={thread.id}>
            <header>
              <h3>
                {thread.campaign || "Conversation"}
                {thread.sentiment && <span className={`sentiment-badge sentiment-${thread.sentiment}`}>{thread.sentiment}</span>}
              </h3>
              <small>{[thread.sender, when(thread.lastMessageAt)].filter(Boolean).join(" · ")}</small>
            </header>
            <div className="database-activity-thread">
              {messages.map((message) => {
                const inbound = message.direction !== "outbound";
                return (
                  <div className={`bubble ${inbound ? "inbound" : "outbound"} ${message.id === latestInboundId ? "latest-inbound" : ""}`} key={message.id}>
                    {inbound && <span><PhotoOr src={detail.photoUrl} fallback={initials(leadName)} /></span>}
                    <small className="message-author">{inbound ? leadName : message.authorName}</small>
                    <p>{display(message.body)}</p>
                    <time>{when(message.sentAt)}</time>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {threads.length === 0 && <p className="empty-state">No conversation history is stored for this lead yet.</p>}
    </div>
  );
}
