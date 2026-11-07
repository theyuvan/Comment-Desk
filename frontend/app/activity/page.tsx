"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { FileSignature, FileText, Gavel, MessageSquare, ShieldAlert, UserPlus } from "lucide-react"
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

const KIND_ICON: Record<Receipt["kind"], typeof UserPlus> = {
  policy: FileSignature,
  join: UserPlus,
  docket: FileText,
  comment: MessageSquare,
  ruling: Gavel,
  moderation: ShieldAlert,
}

const dayOf = (at: number) => new Date(at).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
const timeOf = (at: number) => new Date(at).toLocaleTimeString(undefined, { timeStyle: "short" })

/** Consecutive receipts from the same calendar day, so the feed reads as a timeline, not a flat list. */
function groupByDay(receipts: Receipt[]) {
  const groups: { day: string; items: Receipt[] }[] = []
  for (const item of receipts) {
    const day = dayOf(item.startedAt)
    const last = groups[groups.length - 1]
    if (last?.day === day) last.items.push(item)
    else groups.push({ day, items: [item] })
  }
  return groups
}

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
  const countFor = (itemKinds: Receipt["kind"][]) =>
    receipts ? receipts.filter((item) => itemKinds.length === 0 || itemKinds.includes(item.kind)).length : undefined
  const groups = visible ? groupByDay(visible) : []

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

      <div className="mb-10 flex flex-wrap gap-2" role="tablist" aria-label="Filter by action">
        {KINDS.map((item, index) => {
          const count = countFor(item.kinds)
          return (
            <button
              key={item.label}
              type="button"
              role="tab"
              aria-selected={filter === index}
              onClick={() => setFilter(index)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs transition-colors ${
                filter === index
                  ? "border-foreground bg-foreground text-background"
                  : "border-foreground/15 text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              }`}
            >
              {item.label}
              {count !== undefined && (
                <span className={`font-mono text-[10px] ${filter === index ? "text-background/70" : "text-muted-foreground/70"}`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {!visible && !error && <Loading>Reading the activity log…</Loading>}
      {visible?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing recorded yet. Join, open a docket or post a comment, and every step shows up here.
        </p>
      )}

      {groups.map((group, groupIndex) => (
        <section key={group.day} className="mb-10 last:mb-0">
          <h2 className="sticky top-16 z-10 mb-5 inline-block rounded-full border border-foreground/10 bg-background/90 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground backdrop-blur">
            {group.day}
          </h2>
          <ol className="relative space-y-4 border-l border-foreground/10 pl-7">
            {group.items.map((item, itemIndex) => {
              const Icon = KIND_ICON[item.kind]
              return (
                <li key={item.id} className="relative">
                  <span
                    aria-hidden="true"
                    className="absolute -left-[2.35rem] top-0 flex h-8 w-8 items-center justify-center rounded-full border border-foreground/15 bg-background"
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.6} />
                  </span>
                  <ReceiptPanel
                    title={`${TITLE[item.kind]} · ${item.subject}`}
                    receipt={item}
                    time={timeOf(item.startedAt)}
                    collapsible
                    defaultOpen={groupIndex === 0 && itemIndex === 0}
                  />
                </li>
              )
            })}
          </ol>
        </section>
      ))}
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
