"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { Lock, Pencil } from "lucide-react"
import type { Hex, Address } from "viem"
import { api, type Health, type Stats } from "@/lib/api"
import { recountInBrowser } from "@/lib/recount-client"
import { Big, Hint, Press, Verdict } from "./shared"

/* A small database that draws its own links: one docket, the records tied to it. */

type NodeId = "docket" | "comment" | "member" | "policy"

const NODES: Record<NodeId, { x: number; y: number; label: string; edit: string; expires: string; holds: string }> = {
  docket: { x: 300, y: 175, label: "docket", edit: "Publisher, signed", expires: "Deadline + 7 days", holds: "Question · status · ruling" },
  comment: { x: 95, y: 70, label: "comment", edit: "Nobody", expires: "With its docket", holds: "Text · topic · stance" },
  member: { x: 505, y: 70, label: "member", edit: "Nobody", expires: "≈ 182 days", holds: "ENS name · hashed wallet" },
  policy: { x: 505, y: 285, label: "policy", edit: "Nobody", expires: "≈ 182 days", holds: "Policy · signature hash" },
}
const LINKS: [NodeId, NodeId][] = [["docket", "comment"], ["docket", "member"], ["comment", "member"], ["member", "policy"]]

export function EntityGraph({ bare = false }: { bare?: boolean }) {
  const [picked, setPicked] = useState<NodeId>("comment")
  const chosen = NODES[picked]
  const graph = (
      <svg viewBox="0 0 600 350" className="w-full" role="group" aria-label="Arkiv entities and how they link">
        {LINKS.map(([from, to]) => {
          const a = NODES[from]
          const b = NODES[to]
          const lit = from === picked || to === picked
          return (
            <g key={`${from}-${to}`}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeOpacity={lit ? 0.75 : 0.18} />
              {lit && (
                <circle r="4" fill="currentColor">
                  <animateMotion dur="1.8s" repeatCount="indefinite" path={`M${a.x},${a.y} L${b.x},${b.y}`} />
                </circle>
              )}
            </g>
          )
        })}
        {(Object.keys(NODES) as NodeId[]).map((id) => {
          const node = NODES[id]
          const on = id === picked
          return (
            <g
              key={id}
              role="button"
              tabIndex={0}
              aria-label={`Show the ${node.label} entity`}
              aria-pressed={on}
              onClick={() => setPicked(id)}
              onKeyDown={(event) => {
                if (event.key === "Enter") setPicked(id)
              }}
              className="cursor-pointer outline-none"
            >
              {/* Stacked rims make each node read as a database cylinder. */}
              {[14, 0, -14].map((dy) => (
                <ellipse
                  key={dy}
                  cx={node.x}
                  cy={node.y + dy}
                  rx="66"
                  ry="20"
                  fill={on ? "var(--foreground)" : "var(--background)"}
                  stroke={on ? "var(--background)" : "currentColor"}
                  strokeOpacity={on ? 1 : 0.55}
                />
              ))}
              <text x={node.x} y={node.y - 9} textAnchor="middle" className="font-mono" fontSize="14" fill={on ? "var(--background)" : "currentColor"}>
                {node.label}
              </text>
            </g>
          )
        })}
      </svg>
  )
  if (bare) return graph
  return (
    <div className="grid items-center gap-8 lg:grid-cols-[1.5fr_1fr]">
      {graph}
      <div key={picked} className="border border-foreground/20 duration-300 animate-in fade-in">
        <div className="border-b border-foreground/15 p-4 font-display text-3xl">{chosen.label}</div>
        {[
          ["Holds", chosen.holds],
          ["Who can edit", chosen.edit],
          ["Expires", chosen.expires],
        ].map(([name, value]) => (
          <div key={name} className="flex items-center justify-between gap-4 border-b border-foreground/15 p-4 text-sm last:border-b-0">
            <span className="font-mono text-[11px] text-foreground/50">{name}</span>
            <span className="text-right">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* Pretend to be the admin. Editing a read-only entity is the whole point. */

export function TamperTest() {
  const [where, setWhere] = useState<"postgres" | "arkiv">("arkiv")
  const [tampered, setTampered] = useState(false)
  const changed = where === "postgres" && tampered
  const reset = (value: "postgres" | "arkiv") => {
    setWhere(value)
    setTampered(false)
  }
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center gap-2">
        <Press active={where === "postgres"} onClick={() => reset("postgres")}>Postgres</Press>
        <Press active={where === "arkiv"} onClick={() => reset("arkiv")}>Arkiv</Press>
      </div>
      <div className="border border-foreground/25 p-6">
        <Hint>comment-1 · emissions</Hint>
        <p className={`mt-4 font-display text-3xl tracking-tight transition-all md:text-4xl ${changed ? "line-through decoration-2 opacity-40" : ""}`}>Support the rule.</p>
        {changed && <p className="mt-2 font-display text-3xl tracking-tight duration-300 animate-in fade-in md:text-4xl">Oppose the rule.</p>}
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Press onClick={() => setTampered(true)} disabled={tampered}>
            <span className="inline-flex items-center gap-2"><Pencil className="h-3 w-3" /> Edit as admin</span>
          </Press>
          {tampered && (where === "arkiv" ? (
            <Verdict ok={false}><span className="inline-flex items-center gap-2"><Lock className="h-3 w-3" /> Refused: readonly, even for us</span></Verdict>
          ) : (
            <span className="font-mono text-xs">Row changed. Nobody can tell.</span>
          ))}
        </div>
      </div>
    </div>
  )
}

/* Drag the chain forward and watch each record leave on its own schedule. */

const SHELF = [
  { name: "comment", gone: 42 },
  { name: "docket", gone: 42 },
  { name: "member", gone: 182 },
  { name: "policy", gone: 182 },
]

export function ExpiryDial() {
  const [day, setDay] = useState(0)
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="font-display text-5xl tabular-nums">Day {day}</span>
        <Hint>Example: a 35-day docket</Hint>
      </div>
      <input
        type="range"
        min={0}
        max={200}
        value={day}
        onChange={(event) => setDay(Number(event.target.value))}
        aria-label="Days after the docket opened"
        className="w-full accent-foreground"
      />
      <div className="mt-7 space-y-2">
        {SHELF.map((row) => {
          const live = day < row.gone
          return (
            <div key={row.name} className="flex items-center gap-3">
              <span className="w-20 font-mono text-xs">{row.name}</span>
              <div className="relative h-7 flex-1 bg-foreground/5">
                <div className="absolute inset-y-0 left-0 bg-foreground/15" style={{ width: `${(row.gone / 200) * 100}%` }} />
                <div className={`absolute inset-y-0 left-0 transition-all ${live ? "bg-foreground" : "bg-transparent"}`} style={{ width: `${(Math.min(day, row.gone) / 200) * 100}%` }} />
              </div>
              <span className="w-16 text-right font-mono text-[11px] text-foreground/60">{live ? "live" : "expired"}</span>
            </div>
          )
        })}
      </div>
      <p className="mt-6 text-center font-display text-2xl tracking-tight">No cron job. The chain enforces it.</p>
    </div>
  )
}

/* A real recount: this slide talks to Arkiv from the browser, with no server and no key. */

type RecountState = { state: "idle" | "running" | "failed" | "none" } | { state: "done"; title: string; counted: number; block: string; ms: number; matches: boolean }

export function LiveRecount() {
  const [stats, setStats] = useState<Stats | null>()
  const [health, setHealth] = useState<Health>()
  const [run, setRun] = useState<RecountState>({ state: "idle" })

  useEffect(() => {
    api.stats().then(setStats).catch(() => setStats(null))
    api.health().then(setHealth).catch(() => {})
  }, [])

  const recount = async () => {
    setRun({ state: "running" })
    try {
      const dockets = await api.dockets()
      const tallies = await Promise.all(dockets.slice(0, 12).map((docket) => api.tally(docket.key).catch(() => null)))
      const n = tallies.findIndex((tally) => tally && tally.counted > 0)
      const candidate = dockets[n]
      const theirs = tallies[n]
      if (!candidate || !theirs || !health) return setRun({ state: "none" })
      const started = performance.now()
      const mine = await recountInBrowser(candidate.key as Hex, health.publisher as Address)
      const ms = Math.round(performance.now() - started)
      setRun({
        state: "done",
        title: mine.title,
        counted: mine.tally.counted,
        block: mine.block.toString(),
        ms,
        matches: mine.tally.counted === theirs.counted,
      })
    } catch {
      setRun({ state: "failed" })
    }
  }

  const cards: [number | string, string][] = stats
    ? [[stats.dockets, "dockets"], [stats.comments, "comments"], [stats.members, "members"]]
    : [["–", "dockets"], ["–", "comments"], ["–", "members"]]

  return (
    <div className="grid items-center gap-10 lg:grid-cols-2">
      <div>
        <Big>Don&apos;t trust the count. Rebuild it.</Big>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Press onClick={recount} disabled={run.state === "running"} active>
            {run.state === "running" ? "Reading Arkiv…" : "Recount from this browser"}
          </Press>
          <Link href="/dockets" className="font-mono text-xs underline underline-offset-4">Open a docket</Link>
        </div>
        {stats === null && <p className="mt-4 font-mono text-xs text-foreground/50">Backend offline: start it to see live numbers.</p>}
      </div>
      <div>
        <div className="grid grid-cols-3 gap-px border border-foreground/15 bg-foreground/15">
          {cards.map(([value, label]) => (
            <div key={label} className="bg-background p-5">
              <div className="font-display text-4xl tabular-nums sm:text-5xl">{value}</div>
              <div className="mt-2 font-mono text-[11px] text-foreground/55">{label}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 min-h-[92px] border border-foreground/20 p-4 font-mono text-xs leading-relaxed">
          {run.state === "idle" && <span className="text-foreground/50">Browser → Arkiv. No server. No key.</span>}
          {run.state === "running" && <span className="text-foreground/50">Querying Rabdi…</span>}
          {run.state === "none" && <span>No docket with comments yet.</span>}
          {run.state === "failed" && <span>Arkiv didn&apos;t answer. Try again.</span>}
          {run.state === "done" && (
            <>
              <div>Block {run.block} · {run.ms} ms</div>
              <div className="text-foreground/60">{run.title}</div>
              <div className="mt-2 inline-block border border-foreground px-2 py-1">
                {run.counted} counted · {run.matches ? "matches the tally" : "DOES NOT MATCH"}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* Three real, documented incidents, not an abstract claim. Big numbers, one line each. */

const INCIDENTS = [
  {
    count: "20,000",
    place: "Southern California",
    caption: "fake comments, real names, no consent",
    source: "Canary Media, 16 Mar 2026",
    href: "https://www.canarymedia.com/articles/heat-pumps/did-fake-comments-sink-socal-clean-heat-rules",
    image: "/evidence/civiclick-canary-media.png",
  },
  {
    count: "18M of 22M",
    place: "FCC net neutrality docket",
    caption: "comments were fake",
    source: "Stanford / Jeff Kao analysis, 2017",
    href: "https://en.wikipedia.org/wiki/Restoring_Internet_Freedom_Order",
    image: "/evidence/fcc-wikipedia.png",
  },
  {
    count: "37,000",
    place: "Washington State",
    caption: "fake comments, one night",
    source: "Techdirt, 10 Mar 2026",
    href: "https://www.techdirt.com/2026/03/10/37000-fake-ai-comments-mysteriously-oppose-washington-states-effort-to-tax-the-rich/",
    image: null,
  },
] as const

export function ProblemEvidence() {
  return (
    <div>
      <Big>Not a claim. Three documented incidents.</Big>
      <div className="mt-10 grid gap-5 sm:grid-cols-3">
        {INCIDENTS.map(({ count, place, caption, source, href, image }) => (
          <a
            key={place}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="group block overflow-hidden rounded-2xl bg-foreground/[0.04] transition-colors hover:bg-foreground/[0.07]"
          >
            <div className="relative aspect-[16/10] w-full overflow-hidden bg-foreground/10">
              {image ? (
                <Image
                  src={image}
                  alt={`Source reporting on ${place}`}
                  fill
                  sizes="(min-width: 640px) 33vw, 100vw"
                  className="object-cover object-top grayscale transition-all duration-300 group-hover:grayscale-0"
                />
              ) : (
                <div className="flex h-full items-center justify-center font-mono text-[11px] text-foreground/40">
                  Source blocks automated screenshots
                </div>
              )}
            </div>
            <div className="p-5">
              <div className="font-display text-5xl leading-none tracking-tight">{count}</div>
              <div className="mt-3 text-base">{caption}</div>
              <div className="mt-3 font-mono text-[10px] uppercase tracking-widest text-foreground/45">{place} · {source}</div>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
