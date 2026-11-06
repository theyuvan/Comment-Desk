"use client";
import Link from "next/link";

import { useCallback, useEffect, useState } from "react";
import type { DraftDto } from "@commentdesk/shared";
import { api, ApiFailure } from "./api";
import { explain } from "./reasons";

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const fmt = (s: number) => (s <= 0 ? "0:00" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

/**
 * Agent-drafted path. The member reviews what their agent parked, may edit it, then
 * approves it with a fresh World ID Agent Pass step-up scoped to that exact draft.
 * There is no "post" button that skips World ID.
 */
export function AgentDraftReview({ docketKey }: { docketKey: string }) {
  const [drafts, setDrafts] = useState<DraftDto[]>([]);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const now = useNow();

  const load = useCallback(async () => {
    try {
      setDrafts(await api<DraftDto[]>(`/api/drafts?docketKey=${encodeURIComponent(docketKey)}`));
    } catch (err) {
      if (!(err instanceof ApiFailure && err.reason === "not_a_member")) setError(String(err));
    }
  }, [docketKey]);

  useEffect(() => {
    // Initial fetch + poll: the agent writes drafts out-of-band, and drafts expire server-side.
    const first = setTimeout(load, 0);
    const t = setInterval(load, 3000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  async function save(d: DraftDto) {
    setError(null);
    try {
      await api(`/api/drafts/${d.draftKey}`, { method: "PATCH", body: { text: editing[d.draftKey] } });
      setEditing((prev) => {
        const next = { ...prev };
        delete next[d.draftKey];
        return next;
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiFailure ? explain(err.reason, err.message) : String(err));
    }
  }

  async function reject(d: DraftDto) {
    await api(`/api/drafts/${d.draftKey}`, { method: "DELETE" });
    await load();
  }

  const active = drafts.filter((d) => d.status === "pending" || d.status === "confirming");
  const done = drafts.filter((d) => d.status === "posted" || d.status === "discarded");

  return (
    <div className="agent-review">
      {error && <p className="denied" role="alert">{error}</p>}
      {active.length === 0 && (
        <p className="hint">
          No drafts from your agent on this docket yet. Give your agent a token on the <Link href="/agent">Agent</Link> page.
        </p>
      )}
      {active.map((d) => (
        <article key={d.draftKey} className={`draft draft-${d.status}`}>
          <header>
            <span className="badge badge-agent">Agent draft · rev {d.revision}</span>
            <span className="topic">{d.topic}</span> <span className="topic">{d.sentiment}</span>
            <code title="sha256 of docket + topic + position + text: what you approve">#{d.draftHash.slice(0, 12)}</code>
          </header>
          {editing[d.draftKey] !== undefined ? (
            <textarea
              value={editing[d.draftKey]}
              onChange={(e) => setEditing({ ...editing, [d.draftKey]: e.target.value })}
              rows={4}
            />
          ) : (
            <blockquote>{d.text}</blockquote>
          )}
          {d.status === "confirming" ? (
            <p className="countdown">
              Waiting for your World ID confirm — {fmt((d.confirmExpiresAt ?? now) - now)} left, then this draft is discarded.
            </p>
          ) : (
            <p className="hint">Draft expires in {fmt(d.expiresAt - now)} if not approved.</p>
          )}
          <div className="row">
            {editing[d.draftKey] !== undefined ? (
              <button className="btn" onClick={() => save(d)}>Save edit</button>
            ) : (
              <button className="btn" disabled={d.status !== "pending"} onClick={() => setEditing({ ...editing, [d.draftKey]: d.text })}>
                Edit
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => reject(d)}>Reject</button>
            {/* Full-page POST: the backend redirects to World IdP for a fresh, draft-scoped step-up. */}
            <form method="post" action="/api/agent-pass/start">
              <input type="hidden" name="draftKey" value={d.draftKey} />
              <button className="btn btn-agentpass" disabled={editing[d.draftKey] !== undefined}>
                {d.status === "confirming" ? "Restart World ID Agent Pass" : "Approve with World ID Agent Pass"}
              </button>
            </form>
          </div>
        </article>
      ))}
      {done.length > 0 && (
        <details className="history">
          <summary>Earlier drafts ({done.length})</summary>
          {done.map((d) => (
            <p key={d.draftKey} className={d.status === "posted" ? "ok" : "denied"}>
              <code>#{d.draftHash.slice(0, 12)}</code>{" "}
              {d.status === "posted" ? `Posted as ${d.posted?.ensName}` : explain(d.discardReason ?? "discarded")}
            </p>
          ))}
        </details>
      )}
    </div>
  );
}
