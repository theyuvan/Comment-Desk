"use client";

import { useEffect, useState } from "react";
import { api as desk, type Docket } from "@/lib/api";
import { api, ApiFailure } from "./api";
import { explain } from "./reasons";

/** Issues a token the member's own agent uses to read dockets and park drafts. It can't post. */
export function AgentTokenPanel() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dockets, setDockets] = useState<Docket[]>([]);
  const [docketKey, setDocketKey] = useState("");

  useEffect(() => {
    desk
      .dockets()
      .then((all) => setDockets(all.filter((docket) => docket.phase === "open")))
      .catch(() => setDockets([]));
  }, []);

  async function issue() {
    setError(null);
    try {
      setToken((await api<{ token: string }>("/api/agent/tokens", { body: { label: "my-agent" } })).token);
    } catch (err) {
      setError(err instanceof ApiFailure ? explain(err.reason, err.message) : String(err));
    }
  }

  const docket = dockets.find((item) => item.key === docketKey) ?? dockets[0];

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
          {docket ? (
            <>
              {dockets.length > 1 && (
                <select aria-label="Docket for the example" value={docket.key} onChange={(event) => setDocketKey(event.target.value)}>
                  {dockets.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.title}
                    </option>
                  ))}
                </select>
              )}
              <p className="hint">Draft a comment (what your agent does):</p>
              <pre>{`npm run agent -w backend -- draft --token ${token} \\
  --docket ${docket.key} --topic ${docket.topics[0]} --sentiment support \\
  --text "Your agent's draft goes here."`}</pre>
            </>
          ) : (
            <p className="hint">Open a docket first; your agent drafts against an open one.</p>
          )}
          <p className="hint">Rewrite it after you started approving (the draft-mismatch demo):</p>
          <pre>{`npm run agent -w backend -- edit --token ${token} \\
  --draft <draftKey> --text "Something you never approved."`}</pre>
        </>
      )}
    </div>
  );
}
