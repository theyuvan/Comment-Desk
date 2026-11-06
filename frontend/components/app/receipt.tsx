"use client"

import { useEffect, useState } from "react"
import { api, explorer, type Receipt, type ReceiptStep } from "@/lib/api"

const CHAIN = { world: "World ID", arkiv: "Arkiv", sepolia: "ENS · Sepolia", swarm: "Swarm" } as const

const short = (value: string) => (value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value)

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
    <ol className="space-y-2 font-mono text-xs">
      {receipt.steps.map((step, index) => (
        <li key={`${step.label}-${index}`} className="grid grid-cols-[1.25rem_1fr] gap-x-2">
          <span aria-hidden="true" className={step.status === "failed" ? "text-destructive" : "text-foreground"}>
            {step.status === "failed" ? "✗" : "✓"}
          </span>
          <span className="space-y-0.5">
            <span className="block text-foreground">{step.label}</span>
            <span className="flex flex-wrap gap-x-3 text-muted-foreground">
              <span>{CHAIN[step.chain]}</span>
              <Links step={step} />
            </span>
          </span>
        </li>
      ))}
      {upcoming.map((label, index) => (
        <li key={label} className="grid grid-cols-[1.25rem_1fr] gap-x-2 text-muted-foreground">
          <span aria-hidden="true">{!running && receipt.status === "done" ? "✓" : running && index === 0 ? "◌" : "○"}</span>
          <span>
            {label}
            {running && index === 0 && <span className="ml-2 animate-pulse">waiting for the chain…</span>}
            {receipt.status === "done" && <span className="ml-2">(already in place)</span>}
          </span>
        </li>
      ))}
      {receipt.status === "failed" && (
        <li className="text-destructive">Stopped: {receipt.error ?? "failed"}. Nothing after this step was recorded.</li>
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

/** A titled box around a receipt, for pages that show one. */
export function ReceiptPanel({ title, receipt }: { title: string; receipt: Receipt }) {
  const seconds = Math.max(0, Math.round(((receipt.finishedAt ?? Date.now()) - receipt.startedAt) / 1000))
  return (
    <section className="border border-foreground/15 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="font-mono text-xs text-muted-foreground">
          {receipt.status === "running" ? `working · ${seconds}s` : receipt.status === "done" ? `done in ${seconds}s` : "stopped"}
        </span>
      </div>
      <ReceiptView receipt={receipt} />
    </section>
  )
}
