"use client"

/**
 * STAND-IN. The World branch's frontend/src/world/AgentTokenPanel.tsx replaces
 * this file, and issues the token a member's own agent uses to park drafts.
 */
export function AgentTokenPanel() {
  return (
    <div className="card">
      <p>
        Your agent can read a docket and draft a comment for you. It can never post: every draft waits for you to
        approve that exact text with a fresh World ID Agent Pass confirm.
      </p>
      <p className="hint">
        Agent tokens arrive when World ID is connected. Until then, open a docket, choose &quot;My agent drafted this&quot;
        and paste a draft to try the approval flow.
      </p>
    </div>
  )
}
