"use client"

import Link from "next/link"
import { Eyebrow, Loading, Notice, Shell, useMember } from "@/components/app/shell"
import { AgentTokenPanel } from "@/world/AgentTokenPanel"

export default function AgentPage() {
  const { member } = useMember()

  return (
    <Shell>
      <Eyebrow>Your agent</Eyebrow>
      <h1 className="mb-8 font-display text-5xl tracking-tight">It drafts. You decide.</h1>
      <div className="max-w-2xl">
        {member === undefined && <Loading>Checking your identity…</Loading>}
        {member === null && (
          <Notice>
            <Link href="/join?next=/agent" className="underline underline-offset-4">
              Join or sign in
            </Link>{" "}
            to connect your agent.
          </Notice>
        )}
        {member && <AgentTokenPanel />}
      </div>
    </Shell>
  )
}
