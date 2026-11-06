"use client";
import Link from "next/link";

import { Suspense, use, useCallback, useEffect, useState } from "react";
import type { DocketInfo } from "@commentdesk/shared";
import { api, ApiFailure } from "@/world/api";
import { useSession } from "@/world/useSession";
import { HumanCommentComposer } from "@/world/HumanCommentComposer";
import { AgentDraftReview } from "@/world/AgentDraftReview";
import { AgentPassResult } from "@/world/AgentPassResult";

interface PostedComment {
  commentRef: string;
  ensName: string;
  topic: string;
  text: string;
  authorType: "human" | "agent";
  memberEnsName: string;
}

export function DocketView({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const { session } = useSession();
  const [docket, setDocket] = useState<DocketInfo | null>(null);
  const [comments, setComments] = useState<PostedComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState<"human" | "agent">("human");

  const load = useCallback(async () => {
    try {
      const data = await api<{ docket: DocketInfo; comments?: PostedComment[] }>(`/api/dockets/${encodeURIComponent(key)}`);
      setDocket(data.docket);
      setComments(data.comments ?? []);
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : String(err));
    }
  }, [key]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  if (error) return <p className="denied">{error}</p>;
  if (!docket) return <p className="hint">Loading…</p>;

  return (
    <>
      <Suspense>
        <AgentPassResult />
      </Suspense>
      <h1>{docket.title}</h1>
      <p className="meta">
        {docket.ensName && <code>{docket.ensName}</code>}
        <span className={`badge badge-${docket.credentialLevel}`}>
          {docket.credentialLevel === "strict" ? "Strict: Proof of Human (Orb)" : "Soft: Selfie Check"}
        </span>
        <span>closes {new Date(docket.deadline * 1000).toLocaleString()}</span>
      </p>

      {session === null && (
        <p className="card">
          <Link href="/join">Join with World ID</Link> to comment.
        </p>
      )}
      {session && (
        <section className="compose">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={path === "human"} className={`tab tab-human ${path === "human" ? "on" : ""}`} onClick={() => setPath("human")}>
              I&apos;ll write it myself
              <small>World ID check at submit</small>
            </button>
            <button role="tab" aria-selected={path === "agent"} className={`tab tab-agent ${path === "agent" ? "on" : ""}`} onClick={() => setPath("agent")}>
              My agent drafted it
              <small>Fresh World ID Agent Pass approval of the exact text</small>
            </button>
          </div>
          {path === "human" ? (
            <HumanCommentComposer docket={docket} onPosted={load} />
          ) : (
            <div className="composer composer-agent">
              <AgentDraftReview docketKey={docket.key} />
            </div>
          )}
        </section>
      )}

      <h2>Comments ({comments.length})</h2>
      <ul className="comments">
        {comments.map((c) => (
          <li key={c.commentRef}>
            <header>
              <span className={`badge badge-${c.authorType}`}>{c.authorType === "agent" ? "Agent-drafted · human-approved" : "Human-typed"}</span>
              <span className="topic">{c.topic}</span>
              <code>{c.ensName}</code>
            </header>
            <p>{c.text}</p>
            <small>by {c.memberEnsName}</small>
          </li>
        ))}
      </ul>
    </>
  );
}
