"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import type { Address, Hex } from "viem"
import { Eyebrow, Notice, Shell, useHealth } from "@/components/app/shell"
import { Button } from "@/components/ui/button"
import { api, type Tally } from "@/lib/api"
import { recountInBrowser, type Recount } from "@/lib/recount-client"

const sameCounts = (a: Tally, b: Tally) =>
  a.counted === b.counted &&
  a.stored === b.stored &&
  JSON.stringify(a.topics) === JSON.stringify(b.topics)

export default function RecountPage() {
  const { key } = useParams<{ key: string }>()
  const health = useHealth()
  const [result, setResult] = useState<Recount>()
  const [displayed, setDisplayed] = useState<Tally>()
  const [error, setError] = useState("")

  useEffect(() => {
    if (health?.mode !== "live") return
    recountInBrowser(key as Hex, health.publisher as Address)
      .then(setResult)
      .catch((reason: Error) => setError(reason.message.split("\n")[0] ?? "The recount failed."))
    api.tally(key).then(setDisplayed).catch(() => {})
  }, [health, key])

  return (
    <Shell>
      <Eyebrow>Independent recount</Eyebrow>
      <h1 className="mb-4 font-display text-5xl tracking-tight">Check the count yourself</h1>
      <p className="mb-8 max-w-2xl leading-relaxed text-muted-foreground">
        Your browser just read every comment straight from Arkiv and applied the published counting rule. Our server
        did not supply these numbers.
      </p>

      {health?.mode === "memory" && <Notice>Recounts need real Arkiv data, and this is the local demo.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {health?.mode === "live" && !result && !error && <p className="text-sm text-muted-foreground">Reading Arkiv from your browser…</p>}

      {result && (
        <div className="space-y-6">
          <h2 className="font-display text-2xl tracking-tight">{result.title}</h2>
          <div className="overflow-x-auto border border-foreground/15">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-foreground/15 text-left font-mono text-xs text-muted-foreground">
                  <th className="p-3 font-normal">Topic</th>
                  <th className="p-3 font-normal">Counted</th>
                  <th className="p-3 font-normal">Support</th>
                  <th className="p-3 font-normal">Oppose</th>
                  <th className="p-3 font-normal">Neutral</th>
                  <th className="p-3 font-normal">Human</th>
                  <th className="p-3 font-normal">Agent</th>
                </tr>
              </thead>
              <tbody>
                {result.tally.topics.map((topic) => (
                  <tr key={topic.topic} className="border-b border-foreground/10 last:border-b-0">
                    <td className="p-3">{topic.topic}</td>
                    <td className="p-3">{topic.counted}</td>
                    <td className="p-3">{topic.support}</td>
                    <td className="p-3">{topic.oppose}</td>
                    <td className="p-3">{topic.neutral}</td>
                    <td className="p-3">{topic.human}</td>
                    <td className="p-3">{topic.agent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground">
            {result.tally.counted} counted of {result.tally.stored} stored. {result.tally.ignored.duplicate} extra,{" "}
            {result.tally.ignored.late} late. Read at Arkiv block {result.block.toString()}.
          </p>
          {displayed && (
            <Notice tone={sameCounts(displayed, result.tally) ? "info" : "error"}>
              {sameCounts(displayed, result.tally)
                ? "This matches the tally Comment Desk displays."
                : "This does not match the tally Comment Desk displays."}
            </Notice>
          )}
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">Reproduce this from a terminal</summary>
            <pre className="mt-3 overflow-x-auto border border-foreground/15 p-3 font-mono text-xs">
              {`cd backend && npm install\nnpm run recount -- ${key} ${health?.publisher}`}
            </pre>
          </details>
        </div>
      )}

      <Button asChild variant="outline" className="mt-8 rounded-full">
        <Link href={`/dockets/${key}`}>Back to the docket</Link>
      </Button>
    </Shell>
  )
}
