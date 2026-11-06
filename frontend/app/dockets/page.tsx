"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Countdown } from "@/components/app/countdown"
import { CredentialLabel, DocketPhase } from "@/components/app/docket-phase"
import { Eyebrow, Loading, Notice, Shell } from "@/components/app/shell"
import { Button } from "@/components/ui/button"
import { api, type Docket, type Phase, type Stats } from "@/lib/api"

const FILTERS: { label: string; matches: (phase: Phase) => boolean }[] = [
  { label: "All", matches: () => true },
  { label: "Open", matches: (phase) => phase === "open" },
  { label: "Awaiting ruling", matches: (phase) => phase === "awaiting-ruling" },
  { label: "Concluded", matches: (phase) => phase === "closed" || phase === "closed-for-cause" },
]

export default function DocketsPage() {
  const [dockets, setDockets] = useState<Docket[]>()
  const [stats, setStats] = useState<Stats>()
  const [filter, setFilter] = useState(0)
  const [error, setError] = useState("")

  useEffect(() => {
    api.dockets().then(setDockets).catch((reason: Error) => setError(reason.message))
    api.stats().then(setStats).catch(() => {})
  }, [])

  const visible = dockets?.filter((docket) => FILTERS[filter]!.matches(docket.phase))

  return (
    <Shell>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Open cases and concluded records</Eyebrow>
          <h1 className="font-display text-5xl tracking-tight">Dockets</h1>
        </div>
        <Button asChild className="rounded-full">
          <Link href="/dockets/new">Open a docket</Link>
        </Button>
      </div>

      {stats && (
        <dl className="mb-8 grid grid-cols-2 gap-px border border-foreground/10 bg-foreground/10 sm:grid-cols-4">
          {[
            [stats.dockets, "dockets"],
            [stats.members, "verified members"],
            [stats.comments, "comments on record"],
            [stats.countedComments, "counted in tallies"],
          ].map(([value, label]) => (
            <div key={label} className="bg-background px-4 py-3">
              <dd className="font-display text-3xl tracking-tight">{value}</dd>
              <dt className="text-xs text-muted-foreground">{label}</dt>
            </div>
          ))}
        </dl>
      )}

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter dockets">
        {FILTERS.map((item, index) => (
          <button
            key={item.label}
            type="button"
            aria-pressed={filter === index}
            onClick={() => setFilter(index)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              filter === index ? "border-foreground bg-foreground text-background" : "border-foreground/15 hover:border-foreground"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {!dockets && !error && <Loading>Reading from Arkiv…</Loading>}
      {dockets?.length === 0 && <Notice>No dockets yet. Open the first one.</Notice>}
      {dockets && dockets.length > 0 && visible?.length === 0 && <Notice>No dockets match this filter.</Notice>}

      <ul className="divide-y divide-foreground/10 border-y border-foreground/10 empty:hidden">
        {visible?.map((docket) => (
          <li key={docket.key}>
            <Link href={`/dockets/${docket.key}`} className="block px-1 py-5 transition-colors hover:bg-foreground/[0.03]">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <h2 className="font-display text-2xl tracking-tight">{docket.title}</h2>
                {docket.phase === "open" ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    <Countdown to={docket.deadline} />
                  </span>
                ) : (
                  <DocketPhase docket={docket} />
                )}
              </div>
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{docket.ensName}</p>
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <CredentialLabel docket={docket} />
                {docket.topics.map((topic) => (
                  <span key={topic} className="border border-foreground/10 px-1.5 font-mono">
                    {topic}
                  </span>
                ))}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </Shell>
  )
}
