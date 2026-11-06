"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ReceiptPanel } from "@/components/app/receipt"
import { EnsLink, Eyebrow, Loading, Notice, Shell, useHealth } from "@/components/app/shell"
import { api, type Receipt } from "@/lib/api"

const KINDS: { label: string; kinds: Receipt["kind"][] }[] = [
  { label: "All", kinds: [] },
  { label: "Joins", kinds: ["join"] },
  { label: "Dockets", kinds: ["docket"] },
  { label: "Comments", kinds: ["comment"] },
  { label: "Rulings", kinds: ["ruling", "moderation"] },
  { label: "Policies", kinds: ["policy"] },
]

const TITLE: Record<Receipt["kind"], string> = {
  policy: "Policy signed",
  join: "Member joined",
  docket: "Docket opened",
  comment: "Comment posted",
  ruling: "Ruling published",
  moderation: "Closed by a moderator",
}

const time = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

function Activity() {
  const subject = useSearchParams().get("subject") ?? undefined
  const health = useHealth()
  const [receipts, setReceipts] = useState<Receipt[]>()
  const [filter, setFilter] = useState(0)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      try {
        const found = await api.activity({ subject, limit: 100 })
        if (!active) return
        setReceipts(found)
        setError("")
        // Keep up with anything still being written.
        if (found.some((item) => item.status === "running")) timer = setTimeout(load, 3000)
      } catch (reason) {
        if (active) setError((reason as Error).message)
      }
    }
    load()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [subject])

  const { kinds } = KINDS[filter]!
  const visible = receipts?.filter((item) => kinds.length === 0 || kinds.includes(item.kind))

  return (
    <>
      <Eyebrow>Proof, not promises</Eyebrow>
      <h1 className="mb-3 font-display text-5xl tracking-tight">On-chain activity</h1>
      <p className="mb-8 max-w-2xl text-lg leading-relaxed text-muted-foreground">
        Every action Comment Desk takes, step by step: the World ID check that allowed it, the Arkiv entities it wrote
        and the ENS transactions it sent on Sepolia. Each link opens the public record, so none of it rests on our word.
      </p>
      {health?.mode === "live" && (
        <p className="mb-8 break-all font-mono text-xs text-muted-foreground">
          Arkiv publisher {health.publisher} · ENS root <EnsLink name={health.rootName} />
        </p>
      )}

      {subject && (
        <div className="mb-6">
          <Notice>
            Showing <span className="font-mono">{subject}</span> only.{" "}
            <Link href="/activity" className="underline underline-offset-4">
              Show everything
            </Link>
          </Notice>
        </div>
      )}

      <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Filter by action">
        {KINDS.map((item, index) => (
          <button
            key={item.label}
            type="button"
            role="tab"
            aria-selected={filter === index}
            onClick={() => setFilter(index)}
            className={`border px-3 py-1 text-xs transition-colors ${
              filter === index ? "border-foreground bg-foreground text-background" : "border-foreground/15 hover:bg-foreground/5"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {!visible && !error && <Loading>Reading the activity log…</Loading>}
      {visible?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing recorded yet. Join, open a docket or post a comment, and every step shows up here.
        </p>
      )}
      <div className="space-y-4">
        {visible?.map((item) => (
          <div key={item.id}>
            <p className="mb-1 font-mono text-xs text-muted-foreground">{time(item.startedAt)}</p>
            <ReceiptPanel title={`${TITLE[item.kind]} · ${item.subject}`} receipt={item} />
          </div>
        ))}
      </div>
    </>
  )
}

export default function ActivityPage() {
  return (
    <Shell>
      <Suspense fallback={<Loading>Reading the activity log…</Loading>}>
        <Activity />
      </Suspense>
    </Shell>
  )
}
