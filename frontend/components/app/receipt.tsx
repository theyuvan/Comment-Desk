"use client"

import { useEffect, useState, type ReactNode } from "react"
import { api, explorer, type Receipt, type ReceiptStep } from "@/lib/api"

const CHAIN = { world: "World ID", arkiv: "Arkiv", sepolia: "ENS · Sepolia", swarm: "Swarm" } as const

const short = (value: string) => (value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value)

/** A quiet, monochrome tag naming which service a step's proof lives on. */
function ChainBadge({ chain }: { chain: ReceiptStep["chain"] }) {
  return (
    <span className="inline-flex items-center rounded-full border border-foreground/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
      {CHAIN[chain]}
    </span>
  )
}

function Links({ step }: { step: ReceiptStep }) {
  const link = (href: string, text: string) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">
      {text} ↗
    </a>
  )
  return (
    <span className="flex flex-wrap gap-x-3">
      {step.chain === "sepolia" && step.tx && link(explorer.sepoliaTx(step.tx), `tx ${short(step.tx)}`)}
      {step.chain === "arkiv" && step.entityKey && link(explorer.arkivEntity(step.entityKey), `entity ${short(step.entityKey)}`)}
      {step.chain === "arkiv" && !step.entityKey && step.tx && <span>tx {short(step.tx)}</span>}
      {step.chain === "swarm" && step.ref && link(explorer.swarm(step.ref), `case file ${short(step.ref)}`)}
      {step.chain === "world" && step.ref && <span title={step.ref}>proof {short(step.ref)}</span>}
    </span>
  )
}

/** Every step an action took, each with something you can look up, and what's still to come. */
export function ReceiptView({ receipt }: { receipt: Receipt }) {
  const done = new Set(receipt.steps.map((step) => step.label))
  // Steps a retried action found already in place never report; once it's finished they count as done.
  const upcoming = receipt.expected.filter((label) => !done.has(label))
  const running = receipt.status === "running"

  return (
    <ol className="space-y-3 border-l border-foreground/10 pl-4 font-mono text-xs">
      {receipt.steps.map((step, index) => (
        <li key={`${step.label}-${index}`} className="relative">
          <span
            aria-hidden="true"
            className={`absolute -left-[1.4rem] top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
              step.status === "failed" ? "bg-destructive text-destructive-foreground" : "bg-foreground text-background"
            }`}
          >
            {step.status === "failed" ? "✗" : "✓"}
          </span>
          <span className="space-y-1">
            <span className="block text-foreground">{step.label}</span>
            <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
              <ChainBadge chain={step.chain} />
              <Links step={step} />
            </span>
          </span>
        </li>
      ))}
      {upcoming.map((label, index) => (
        <li key={label} className="relative text-muted-foreground">
          <span
            aria-hidden="true"
            className="absolute -left-[1.4rem] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-foreground/20 text-[10px]"
          >
            {!running && receipt.status === "done" ? "✓" : running && index === 0 ? "◌" : "○"}
          </span>
          <span>
            {label}
            {running && index === 0 && <span className="ml-2 animate-pulse">waiting for the chain…</span>}
            {receipt.status === "done" && <span className="ml-2">(already in place)</span>}
          </span>
        </li>
      ))}
      {receipt.status === "failed" && (
        <li className="relative text-destructive">
          <span
            aria-hidden="true"
            className="absolute -left-[1.4rem] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground"
          >
            ✗
          </span>
          Stopped: {receipt.error ?? "failed"}. Nothing after this step was recorded.
        </li>
      )}
    </ol>
  )
}

/**
 * The latest receipt for a subject, e.g. "maya.commentdesk.eth". Polls while the action is
 * running, or while `waiting` says one is expected but hasn't appeared yet. `since` skips
 * receipts from earlier attempts.
 */
export function useReceipt(
  subject: string | undefined,
  options: { kind?: Receipt["kind"]; waiting?: boolean; since?: number } = {},
) {
  const [receipt, setReceipt] = useState<Receipt | null>()
  const { kind, waiting = false, since = 0 } = options

  useEffect(() => {
    if (!subject) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      const found = await api
        .activity({ subject, limit: 20 })
        .then((all) => all.find((item) => (!kind || item.kind === kind) && item.startedAt >= since) ?? null)
        .catch(() => null)
      if (!active) return
      setReceipt(found)
      if (found?.status === "running" || (!found && waiting)) timer = setTimeout(load, 2000)
    }
    load()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [subject, kind, waiting, since])

  return receipt
}

/** A small dot + label naming where a receipt stands right now. */
function StatusPill({ receipt, seconds }: { receipt: Receipt; seconds: number }) {
  const tone =
    receipt.status === "failed"
      ? "border-destructive/40 text-destructive"
      : receipt.status === "running"
        ? "border-foreground/20 text-foreground"
        : "border-foreground/15 text-muted-foreground"
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] ${tone}`}>
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          receipt.status === "failed" ? "bg-destructive" : receipt.status === "running" ? "animate-pulse bg-foreground" : "bg-foreground/40"
        }`}
      />
      {receipt.status === "running" ? `working · ${seconds}s` : receipt.status === "done" ? `done in ${seconds}s` : "stopped"}
    </span>
  )
}

/**
 * A titled box around a receipt, for pages that show one. Pass `collapsible` to let it fold
 * down to just the header (the activity feed does, so a long history doesn't read as a wall
 * of checkmarks); every other caller gets the old always-open behaviour unchanged.
 */
export function ReceiptPanel({
  title,
  receipt,
  icon,
  time,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string
  receipt: Receipt
  icon?: ReactNode
  time?: string
  collapsible?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const seconds = Math.max(0, Math.round(((receipt.finishedAt ?? Date.now()) - receipt.startedAt) / 1000))
  const expanded = !collapsible || open

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-foreground/15">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{title}</h3>
          {time && <p className="font-mono text-[11px] text-muted-foreground">{time}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusPill receipt={receipt} seconds={seconds} />
        {collapsible && (
          <span
            aria-hidden="true"
            className={`flex h-6 w-6 items-center justify-center rounded-full border border-foreground/15 text-xs transition-transform ${open ? "rotate-180" : ""}`}
          >
            ↓
          </span>
        )}
      </div>
    </div>
  )

  return (
    <section className="rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-4 transition-colors hover:border-foreground/20 sm:p-5">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="w-full text-left"
        >
          {header}
        </button>
      ) : (
        <div className="mb-3">{header}</div>
      )}
      {expanded && <div className={collapsible ? "mt-4" : undefined}><ReceiptView receipt={receipt} /></div>}
    </section>
  )
}
