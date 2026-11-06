"use client";

import { useState } from "react";
import { api, ApiFailure } from "./api";
import { explain } from "./reasons";

/** Issues a token the member's own agent uses to read dockets and park drafts. It can't post. */
export function AgentTokenPanel() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setError(null);
    try {
      setToken((await api<{ token: string }>("/api/agent/tokens", { body: { label: "my-agent" } })).token);
    } catch (err) {
      setError(err instanceof ApiFailure ? explain(err.reason, err.message) : String(err));
    }
  }

  return (
    <div className="card">
      <p>
        Your agent can read a docket and draft a comment for you. It can never post: every draft waits here until you
        approve that exact text with a fresh World ID Agent Pass confirm.
      </p>
      <button className="btn" onClick={issue}>Issue agent token</button>
      {error && <p className="denied">{error}</p>}
      {token && (
        <>
          <p className="hint">Shown once. Give it to your agent:</p>
          <pre>{token}</pre>
          <p className="hint">Draft a comment (what your agent does):</p>
          <pre>{`npm run agent -w backend -- draft --token ${token} \\
  --docket truck-emissions-rule --topic phase-in-timeline \\
  --text "Phase in over three years, not five."`}</pre>
          <p className="hint">Rewrite it after you started approving (the draft-mismatch demo):</p>
          <pre>{`npm run agent -w backend -- edit --token ${token} \\
  --draft <draftKey> --text "Something you never approved."`}</pre>
        </>
      )}
    </div>
  );
}
