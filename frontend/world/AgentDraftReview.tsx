"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { api, ApiFailure } from "./api"

/**
 * STAND-IN. The World branch's frontend/src/world/AgentDraftReview.tsx replaces
 * this file, with the same name and props. There, drafts arrive from the member's
 * own agent and approval is a full-page World Agent Pass redirect.
 *
 * Here a draft is pasted in, and approval comes back through the same
 * ?agentpass= result so AgentPassResult behaves the same in both.
 */
export function AgentDraftReview({ docketKey }: { docketKey: string }) {
  const router = useRouter()
  const [topics, setTopics] = useState<string[]>([])
  const [topic, setTopic] = useState("")
  const [text, setText] = useState("")
  const [reviewing, setReviewing] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ topics: string[] }>(`/api/dockets/${docketKey}`)
      .then((docket) => {
        setTopics(docket.topics)
        setTopic(docket.topics[0] ?? "")
      })
      .catch(() => {})
  }, [docketKey])

  const result = (status: string, reason?: string) => {
    const params = new URLSearchParams({ agentpass: status })
    if (reason) params.set("reason", reason)
    router.replace(`/dockets/${docketKey}?${params}`, { scroll: false })
  }

  async function confirm(changedAfterApproval: boolean) {
    setBusy(true)
    try {
      await api("/api/dev/agent-confirm", { body: { docketKey, topic, text, changedAfterApproval } })
      result("posted")
    } catch (error) {
      result("denied", error instanceof ApiFailure ? error.reason : "unknown")
    } finally {
      setText("")
      setReviewing(false)
      setBusy(false)
    }
  }

  if (reviewing) {
    return (
      <article className="draft">
        <header>
          <span className="badge badge-agent">Agent draft</span>
          <span className="topic">{topic}</span>
        </header>
        <blockquote>{text}</blockquote>
        <p className="hint">
          Read every word. Your approval covers this exact text, so any change needs a new approval. In this
          development stand-in, World Agent Pass is simulated.
        </p>
        <div className="row">
          <button type="button" className="btn btn-agentpass" onClick={() => confirm(false)} disabled={busy}>
            {busy ? "Confirming…" : "Approve with World ID Agent Pass"}
          </button>
          <button type="button" className="btn" onClick={() => setReviewing(false)} disabled={busy}>
            Edit
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => confirm(true)} disabled={busy}>
            Try: draft changed after approval
          </button>
        </div>
      </article>
    )
  }

  return (
    <div className="agent-review">
      <label className="field">
        <span>Topic</span>
        <select value={topic} onChange={(event) => setTopic(event.target.value)}>
          {topics.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Your agent&apos;s draft</span>
        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} placeholder="Paste what your agent wrote." />
      </label>
      <button type="button" className="btn" disabled={!text.trim() || !topic} onClick={() => setReviewing(true)}>
        Review this draft
      </button>
    </div>
  )
}
