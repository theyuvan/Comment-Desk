"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowRight, Bot, Check, Database, Lock, Unlock, User } from "lucide-react"
import { api, ensUrl, type Docket, type DocketRules } from "@/lib/api"
import { Hint, Press } from "./shared"

/* The name tree. Every node is a real ENSv2 name with its own owner and resolver. */

type Name = { id: string; x: number; y: number; name: string; short: string; owner: string; resolver: string; sale: string }

const TREE: Name[] = [
  { id: "root", x: 300, y: 30, name: "commentdesk.eth", short: "commentdesk.eth", owner: "Platform", resolver: "Registry root", sale: "–" },
  { id: "maya", x: 300, y: 115, name: "maya.commentdesk.eth", short: "maya", owner: "One verified human", resolver: "Her own", sale: "Refused" },
  { id: "agent", x: 120, y: 200, name: "agent.maya.commentdesk.eth", short: "agent.maya", owner: "Maya", resolver: "Maya's", sale: "Refused" },
  { id: "docket", x: 480, y: 200, name: "truck-rule.maya.commentdesk.eth", short: "truck-rule", owner: "Docket creator", resolver: "The docket's own", sale: "Refused" },
  { id: "comment", x: 480, y: 285, name: "comment-1.truck-rule.maya…", short: "comment-1", owner: "Its author", resolver: "The docket's", sale: "Refused" },
]
const EDGES: [string, string][] = [["root", "maya"], ["maya", "agent"], ["maya", "docket"], ["docket", "comment"]]
const byId = (id: string) => TREE.find((node) => node.id === id)!

export function NameTree({ bare = false }: { bare?: boolean }) {
  const [picked, setPicked] = useState("maya")
  const [selling, setSelling] = useState(false)
  const chosen = byId(picked)
  const pick = (id: string) => {
    setPicked(id)
    setSelling(false)
  }
  const tree = (
      <svg viewBox="0 0 600 320" className="w-full" role="group" aria-label="The Comment Desk ENS name tree">
        {EDGES.map(([from, to]) => {
          const a = byId(from)
          const b = byId(to)
          const lit = to === picked
          return (
            <g key={to}>
              <path d={`M${a.x},${a.y} C${a.x},${(a.y + b.y) / 2} ${b.x},${(a.y + b.y) / 2} ${b.x},${b.y}`} fill="none" stroke="currentColor" strokeOpacity={lit ? 0.9 : 0.25} />
            </g>
          )
        })}
        {TREE.map((node) => {
          const on = node.id === picked
          return (
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              aria-label={node.name}
              onClick={() => pick(node.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter") pick(node.id)
              }}
              className="cursor-pointer outline-none"
            >
              <rect x={node.x - 78} y={node.y - 17} width="156" height="34" fill={on ? "var(--foreground)" : "var(--background)"} stroke="currentColor" strokeOpacity={on ? 1 : 0.5} />
              <text x={node.x} y={node.y + 5} textAnchor="middle" fontSize="13" className="font-mono" fill={on ? "var(--background)" : "currentColor"}>
                {node.short}
              </text>
            </g>
          )
        })}
      </svg>
  )
  if (bare) return tree
  return (
    <div className="grid items-center gap-8 lg:grid-cols-[1.5fr_1fr]">
      {tree}
      <div key={picked} className="min-w-0 border border-foreground/20 duration-300 animate-in fade-in">
        <div className="break-all border-b border-foreground/15 p-4 font-mono text-sm">{chosen.name}</div>
        {[
          ["Owner", chosen.owner],
          ["Resolver", chosen.resolver],
        ].map(([name, value]) => (
          <div key={name} className="flex items-center justify-between gap-4 border-b border-foreground/15 p-4 text-sm">
            <span className="font-mono text-[11px] text-foreground/50">{name}</span>
            <span className="text-right">{value}</span>
          </div>
        ))}
        <div className="flex min-h-[64px] items-center justify-between gap-3 p-4">
          {chosen.sale === "Refused" ? (
            <>
              <Press onClick={() => setSelling(true)} disabled={selling}>Try to sell it</Press>
              {selling && <span className="font-mono text-xs duration-300 animate-in fade-in">TransferDisallowed</span>}
            </>
          ) : (
            <span className="font-mono text-[11px] text-foreground/50">Parent of every name here</span>
          )}
        </div>
      </div>
    </div>
  )
}

/* Enhanced Access Control. Pick an account and see exactly what it can touch. */

const ROLES = {
  Creator: ["status", "description", "deadline", "topics", "credential", "agents"],
  Moderator: ["status"],
  Operator: ["status", "arkiv", "author", "swarm"],
} as const
const RECORDS = ["status", "description", "deadline", "topics", "credential", "agents", "arkiv", "author", "swarm"]

export function RoleSwitch() {
  const [role, setRole] = useState<keyof typeof ROLES>("Moderator")
  const allowed: readonly string[] = ROLES[role]
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(Object.keys(ROLES) as (keyof typeof ROLES)[]).map((name) => (
          <Press key={name} active={name === role} onClick={() => setRole(name)}>{name}</Press>
        ))}
        <span className="ml-auto font-display text-3xl tabular-nums">{allowed.length} / {RECORDS.length}</span>
      </div>
      <div className="grid grid-cols-3 gap-px border border-foreground/15 bg-foreground/15">
        {RECORDS.map((record) => {
          const can = allowed.includes(record)
          const Icon = can ? Unlock : Lock
          return (
            <div key={record} className={`flex items-center justify-between gap-2 p-4 transition-colors duration-300 sm:p-6 ${can ? "bg-foreground text-background" : "bg-background text-foreground/40"}`}>
              <span className="min-w-0 truncate font-mono text-xs sm:text-sm">{record}</span>
              <Icon className="h-4 w-4 shrink-0" />
            </div>
          )
        })}
      </div>
      <p className="mt-6 text-center font-display text-2xl tracking-tight">Nobody holds text admin. Nobody can widen this.</p>
    </div>
  )
}

/* The heart of the ENS story: a comment has to pass ENS before Arkiv records it. */

type Author = "human" | "agent"
type Gate = { id: string; record: string; good: string; bad: string; refusal: string; agentOnly?: boolean }

const GATES: Gate[] = [
  { id: "status", record: "status", good: "open", bad: "closed-for-cause", refusal: "docket_closed" },
  { id: "agents", record: "commentdesk.agents", good: "allowed", bad: "none", refusal: "agents_not_allowed", agentOnly: true },
  { id: "name", record: "maya…eth", good: "resolves", bad: "expired", refusal: "ens_unresolved" },
]

export function EnsGate() {
  const [author, setAuthor] = useState<Author>("human")
  const [broken, setBroken] = useState<Record<string, boolean>>({})
  const [at, setAt] = useState(-1)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const clear = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setAt(-1)
    setResult(null)
  }
  useEffect(() => clear, [])

  const run = () => {
    clear()
    const path = GATES.filter((gate) => !gate.agentOnly || author === "agent")
    const stop = path.findIndex((gate) => broken[gate.id])
    const reach = stop === -1 ? path.length : stop
    for (let n = 0; n <= reach; n++) {
      timers.current.push(
        setTimeout(() => {
          setAt(n)
          if (n === reach) {
            setResult(stop === -1 ? { ok: true, text: "Written to Arkiv" } : { ok: false, text: path[stop]!.refusal })
          }
        }, 500 * (n + 1)),
      )
    }
  }

  const path = GATES.filter((gate) => !gate.agentOnly || author === "agent")
  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center gap-2">
        <Press active={author === "human"} onClick={() => { setAuthor("human"); clear() }}>
          <span className="inline-flex items-center gap-2"><User className="h-3 w-3" /> Human</span>
        </Press>
        <Press active={author === "agent"} onClick={() => { setAuthor("agent"); clear() }}>
          <span className="inline-flex items-center gap-2"><Bot className="h-3 w-3" /> Agent</span>
        </Press>
        <button onClick={run} className="ml-auto inline-flex items-center gap-2 bg-foreground px-4 py-2 font-mono text-xs text-background">
          Post comment <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
        {path.map((gate, n) => {
          const down = !!broken[gate.id]
          const passed = at > n
          const here = at === n
          return (
            <div key={gate.id} className="contents">
              <button
                onClick={() => {
                  setBroken((value) => ({ ...value, [gate.id]: !value[gate.id] }))
                  clear()
                }}
                aria-pressed={down}
                aria-label={`${gate.record} is ${down ? gate.bad : gate.good}. Press to change it.`}
                className={`min-w-0 flex-1 border p-4 text-left transition-all duration-300 ${
                  here && down ? "border-foreground bg-foreground text-background" : passed ? "border-foreground" : "border-foreground/25 hover:border-foreground"
                }`}
              >
                <div className="truncate font-mono text-[10px] opacity-60">{gate.record}</div>
                <div className="mt-2 flex items-center justify-between gap-2 font-display text-xl md:text-2xl">
                  <span className={down ? "line-through decoration-1" : ""}>{down ? gate.bad : gate.good}</span>
                  {passed && <Check className="h-4 w-4 shrink-0" />}
                </div>
              </button>
              <ArrowRight className={`hidden h-4 w-4 shrink-0 transition-opacity md:block ${passed ? "" : "opacity-20"}`} />
            </div>
          )
        })}
        <div className={`flex min-w-[140px] flex-1 items-center gap-2 border p-4 transition-all duration-300 ${result?.ok ? "border-foreground bg-foreground text-background" : "border-foreground/25 border-dashed"}`}>
          <Database className="h-5 w-5 shrink-0" />
          <span className="font-display text-xl md:text-2xl">Arkiv</span>
        </div>
      </div>

      <div className="mt-6 flex min-h-[44px] items-center justify-between gap-4">
        <Hint>Press a record to change it</Hint>
        {result && (
          <span className={`border px-3 py-2 font-mono text-xs duration-300 animate-in fade-in ${result.ok ? "border-foreground bg-foreground text-background" : "border-foreground"}`}>
            {result.text}
          </span>
        )}
      </div>
      <LiveRules />
    </div>
  )
}

/* Real records, read from Sepolia through the Universal Resolver. */

function LiveRules() {
  const [live, setLive] = useState<{ docket: Docket; rules: DocketRules } | null>()

  useEffect(() => {
    let active = true
    api
      .dockets()
      .then(async (dockets) => {
        // A docket a moderator closed on ENS alone shows the two records disagreeing.
        const docket = dockets.find((item) => item.ensName.startsWith("gate-rule.")) ?? dockets[0]
        if (!docket) return active && setLive(null)
        const rules = await api.rules(docket.key)
        if (active) setLive({ docket, rules })
      })
      .catch(() => active && setLive(null))
    return () => {
      active = false
    }
  }, [])

  if (!live) return null
  return (
    <a
      href={ensUrl(live.rules.ensName)}
      target="_blank"
      rel="noreferrer"
      className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 border border-foreground/20 p-3 font-mono text-[11px] transition-colors hover:border-foreground"
    >
      <span className="inline-flex items-center gap-2">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground" /> LIVE · SEPOLIA
      </span>
      <span className="text-foreground/60">Arkiv: {live.docket.status}</span>
      <span>ENS: {live.rules.status}</span>
      <span>credential: {live.rules.credential}</span>
      <span>agents: {live.rules.agents}</span>
    </a>
  )
}
