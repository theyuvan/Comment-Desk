"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Eyebrow, Notice, Shell } from "@/components/app/shell"
import { DocketPhase } from "@/components/app/docket-phase"
import { Button } from "@/components/ui/button"
import { api, type Docket } from "@/lib/api"

export default function DocketsPage() {
  const [dockets, setDockets] = useState<Docket[]>()
  const [error, setError] = useState("")

  useEffect(() => {
    api.dockets().then(setDockets).catch((reason: Error) => setError(reason.message))
  }, [])

  return (
    <Shell>
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Open cases and closed records</Eyebrow>
          <h1 className="font-display text-5xl tracking-tight">Dockets</h1>
        </div>
        <Button asChild className="rounded-full">
          <Link href="/dockets/new">Open a docket</Link>
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!dockets && !error && <p className="text-sm text-muted-foreground">Reading from Arkiv…</p>}
      {dockets?.length === 0 && <Notice>No dockets yet. Open the first one.</Notice>}
      <ul className="divide-y divide-foreground/10 border-y border-foreground/10">
        {dockets?.map((docket) => (
          <li key={docket.key}>
            <Link href={`/dockets/${docket.key}`} className="block py-5 transition-colors hover:bg-foreground/[0.03]">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <h2 className="font-display text-2xl tracking-tight">{docket.title}</h2>
                <DocketPhase docket={docket} />
              </div>
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{docket.ensName}</p>
            </Link>
          </li>
        ))}
      </ul>
    </Shell>
  )
}
