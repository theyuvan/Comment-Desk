"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DraftDto } from "@commentdesk/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiFailure } from "./api";
import { explain } from "./reasons";

type Turn = { from: "member" | "agent"; text: string };
type TurnResult = { interviewId: string; reply: string; draft?: DraftDto };

/**
 * The built-in drafting agent. It asks for the member's own view and writes the comment in
 * their words. Whatever it drafts lands in the review below, where only an Agent Pass
 * approval of that exact text can post it.
 */
export function AgentInterview({ docketKey, onDraft }: { docketKey: string; onDraft: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([
    { from: "agent", text: "Tell me what you think about this docket, and I'll draft a comment in your words. Which topic matters to you?" },
  ]);
  const [interviewId, setInterviewId] = useState<string>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [turns]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    setTurns((all) => [...all, { from: "member", text }]);
    setMessage("");
    try {
      const result = await api<TurnResult>("/api/agent/interview", { body: { interviewId, docketKey, message: text } });
      setInterviewId(result.interviewId);
      setTurns((all) => [...all, { from: "agent", text: result.reply }]);
      if (result.draft) onDraft();
    } catch (err) {
      if (err instanceof ApiFailure && err.reason === "agent_unavailable") setUnavailable(true);
      if (err instanceof ApiFailure && err.reason === "interview_expired") setInterviewId(undefined);
      setError(err instanceof ApiFailure ? explain(err.reason, err.message) : String(err));
      setMessage(text);
      setTurns((all) => all.slice(0, -1));
    } finally {
      setBusy(false);
    }
  }

  if (unavailable) {
    return (
      <p className="text-sm text-muted-foreground">
        The built-in drafting agent isn&apos;t switched on here. You can still connect your own agent from the Agent page.
      </p>
    );
  }

  return (
    <section aria-label="Draft with the Comment Desk agent" className="space-y-3">
      <div className="max-h-80 space-y-3 overflow-y-auto border border-foreground/15 p-4 text-sm" aria-live="polite">
        {turns.map((turn, index) => (
          <p key={index} className={turn.from === "member" ? "ml-8 whitespace-pre-wrap text-right" : "mr-8 whitespace-pre-wrap text-muted-foreground"}>
            <span className="sr-only">{turn.from === "member" ? "You: " : "Agent: "}</span>
            {turn.text}
          </p>
        ))}
        {busy && <p className="mr-8 text-muted-foreground">Thinking…</p>}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="space-y-2">
        <Textarea
          aria-label="Your answer to the agent"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) send(event);
          }}
          rows={2}
          maxLength={2000}
          placeholder="Your view, your reasons, anything from your own experience"
          disabled={busy}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">The agent writes only what you tell it. It can&apos;t post: you approve the draft below.</p>
          <Button type="submit" disabled={busy || !message.trim()} className="rounded-full">
            Send
          </Button>
        </div>
      </form>
    </section>
  );
}
