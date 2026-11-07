"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Eye,
  Fingerprint,
  GitBranch,
  KeyRound,
  Lock,
  Maximize,
  Minimize,
  ScanFace,
  ShieldCheck,
  UserCheck,
  type LucideIcon,
} from "lucide-react"
import { api, type Health } from "@/lib/api"
import { ProblemEvidence, EntityGraph, LiveRecount } from "@/components/pitch/arkiv"
import { EnsGate, NameTree, RoleSwitch } from "@/components/pitch/ens"
import { BreakIt, CheckLadder, ProofBinding } from "@/components/pitch/world"
import { Big } from "@/components/pitch/shared"
import { Globe } from "@/components/pitch/globe"
import { ThemeToggle } from "@/components/theme-toggle"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BuiltWith, SponsorMark } from "@/components/visuals/sponsor-marks"

type SponsorId = "arkiv" | "ens" | "world"
type Slide = { label: string; body: ReactNode }

const SPONSORS: { id: SponsorId; name: string }[] = [
  { id: "arkiv", name: "Arkiv" },
  { id: "ens", name: "ENS" },
  { id: "world", name: "World" },
]

const isSponsor = (value: string | null): value is SponsorId => SPONSORS.some((sponsor) => sponsor.id === value)

export default function PitchPage() {
  const [sponsor, setSponsor] = useState<SponsorId>("arkiv")
  const [index, setIndex] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const deck = useRef<HTMLDivElement>(null)
  const slides = DECKS[sponsor]
  const last = slides.length - 1

  const writeUrl = useCallback((id: SponsorId, slide: number) => {
    window.history.replaceState(null, "", `?for=${id}#${slide + 1}`)
  }, [])

  // Fullscreen takes only the deck, not the site bar, like a real presentation.
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else deck.current?.requestFullscreen().catch(() => {})
  }, [])

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === deck.current)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  const go = useCallback(
    (target: number) => {
      const next = Math.max(0, Math.min(last, target))
      setIndex(next)
      writeUrl(sponsor, next)
    },
    [last, sponsor, writeUrl],
  )

  const choose = (id: SponsorId) => {
    setSponsor(id)
    setIndex(0)
    writeUrl(id, 0)
  }

  // Deep links: /pitch?for=ens#3 opens slide 3 of the ENS deck. A link to a new
  // hash on a page already open is a same-document navigation, so this also
  // has to run on hashchange, not just on mount.
  useEffect(() => {
    const read = () => {
      const requested = new URLSearchParams(window.location.search).get("for")
      const id = isSponsor(requested) ? requested : "arkiv"
      setSponsor(id)
      const fromHash = Number(window.location.hash.slice(1))
      if (fromHash >= 1 && fromHash <= DECKS[id].length) setIndex(fromHash - 1)
      else setIndex(0)
    }
    read()
    window.addEventListener("hashchange", read)
    return () => window.removeEventListener("hashchange", read)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      // These keys belong to whatever form control has focus, not the slide.
      if (
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLInputElement
      ) {
        return
      }
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault()
        go(index + 1)
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault()
        go(index - 1)
      } else if (event.key === "Home") go(0)
      else if (event.key === "End") go(last)
      else if (event.key === "f" || event.key === "F") toggleFullscreen()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [index, go, last, toggleFullscreen])

  const slide = slides[Math.min(index, last)]!

  return (
    <div className="noise-overlay flex h-dvh flex-col bg-background text-foreground">
      <div className="dot-grid" aria-hidden="true" />
      <header className="relative z-10 shrink-0 border-b border-foreground/10">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between px-4 py-4 sm:px-8">
          <Link href="/" className="font-display text-xl tracking-tight">
            Comment Desk
          </Link>
          <nav className="flex items-center gap-5 font-mono text-xs text-foreground/50">
            <span className="text-foreground">Pitch</span>
            <Link href="/dockets" className="transition-colors hover:text-foreground">
              Open the app
            </Link>
            <ThemeToggle className="h-7 w-7 border-0 hover:bg-foreground/5" />
          </nav>
        </div>
      </header>

      <div ref={deck} className="relative z-10 flex min-h-0 flex-1 flex-col bg-background text-foreground">
        <div className="dot-grid" aria-hidden="true" />
        <main className="relative z-10 flex min-h-0 flex-1 overflow-y-auto">
          <div
            key={`${sponsor}-${index}`}
            className="m-auto w-full max-w-[1180px] px-4 py-8 duration-500 animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none sm:px-8"
          >
            {index > 0 && (
              <div className="mb-5 font-mono text-[10px] uppercase tracking-widest text-foreground/50">
                [ {String(index + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")} · {slide.label} ]
              </div>
            )}
            {slide.body}
          </div>
        </main>

        <footer className="relative z-10 shrink-0 border-t border-foreground/10">
          <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-3 px-4 py-3 sm:gap-4 sm:px-8">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-foreground/50">
              <span>Pitch for</span>
              <Select value={sponsor} onValueChange={(value) => choose(value as SponsorId)}>
                <SelectTrigger size="sm" className="h-auto border-foreground/30 bg-background px-2 py-1.5 font-mono text-xs normal-case tracking-normal text-foreground hover:border-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SPONSORS.map((item) => (
                    <SelectItem key={item.id} value={item.id} className="font-mono text-xs normal-case tracking-normal">
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <button
              onClick={() => go(index - 1)}
              disabled={index === 0}
              aria-label="Previous slide"
              className="border border-foreground/20 p-2 transition-colors hover:border-foreground disabled:opacity-30"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1.5">
              {slides.map((item, n) => (
                <button
                  key={item.label}
                  onClick={() => go(n)}
                  aria-label={`Slide ${n + 1}: ${item.label}`}
                  aria-current={n === index ? "true" : undefined}
                  className={`h-2 transition-all ${n === index ? "w-8 bg-foreground" : "w-2 bg-foreground/20 hover:bg-foreground/50"}`}
                />
              ))}
            </div>
            <button
              onClick={() => go(index + 1)}
              disabled={index === last}
              aria-label="Next slide"
              className="border border-foreground/20 p-2 transition-colors hover:border-foreground disabled:opacity-30"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
            <span className="ml-auto hidden font-mono text-[10px] uppercase tracking-widest text-foreground/40 lg:inline">
              ← → to move · F for fullscreen
            </span>
            <button
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              className="ml-auto border border-foreground/20 p-2 text-foreground/60 transition-colors hover:border-foreground hover:text-foreground lg:ml-0"
            >
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- pieces */

function Title({ tagline, visual, sponsor }: { tagline: string; visual: ReactNode; sponsor: SponsorId }) {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-[1fr_1.2fr]">
      <div>
        <div className="mb-6 flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-foreground/50">
          <SponsorMark id={sponsor} className="h-4 w-4 shrink-0 text-foreground/70" />
          [ ETHGlobal Mumbai · November 2026 ]
        </div>
        <h1 className="font-display leading-[0.95] tracking-tight" style={{ fontSize: "clamp(3.25rem, 7vw, 5.75rem)" }}>
          Comment Desk
        </h1>
        <p className="mt-6 font-display text-2xl tracking-tight md:text-3xl">{tagline}</p>
      </div>
      <div className="min-w-0">{visual}</div>
    </div>
  )
}

function Stage({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-8">
        <Big>{title}</Big>
      </div>
      {children}
    </div>
  )
}

type Feature = { icon: LucideIcon; name: string; effect: string }

function Features({ items }: { items: Feature[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
      {items.map(({ icon: Icon, name, effect }) => (
        <div
          key={name}
          className="group rounded-2xl bg-foreground/[0.04] p-5 transition-colors duration-300 hover:bg-foreground hover:text-background sm:p-7"
        >
          <Icon className="h-6 w-6" strokeWidth={1.5} />
          <div className="mt-6 font-display text-xl leading-tight sm:text-2xl">{name}</div>
          <div className="mt-2 font-mono text-[11px] leading-relaxed opacity-60">{effect}</div>
        </div>
      ))}
    </div>
  )
}

/** A visual comparison, not a wall of text: short labels, two columns of a few words each. */
function Compare({ against, ours, rows }: { against: string; ours: string; rows: [string, string, string][] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-foreground/10">
      <div className="grid grid-cols-[1fr_1fr_1fr] bg-foreground/[0.04] font-mono text-[10px] uppercase tracking-widest text-foreground/50 sm:text-[11px]">
        <div className="p-3 sm:p-4" />
        <div className="p-3 sm:p-4">{against}</div>
        <div className="p-3 text-foreground sm:p-4">{ours}</div>
      </div>
      {rows.map(([label, theirs, oursValue]) => (
        <div key={label} className="grid grid-cols-[1fr_1fr_1fr] border-t border-foreground/10">
          <div className="p-3 font-display text-base leading-tight sm:p-4 sm:text-lg">{label}</div>
          <div className="p-3 text-xs text-foreground/45 sm:p-4 sm:text-sm">{theirs}</div>
          <div className="p-3 text-xs font-medium sm:p-4 sm:text-sm">{oursValue}</div>
        </div>
      ))}
    </div>
  )
}

/** Icon and name only, no subtext: a quiet reminder of the primitives, next to the table that argues for them. */
function FeatureStrip({ items }: { items: { icon: LucideIcon; name: string }[] }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 sm:mt-6">
      {items.map(({ icon: Icon, name }) => (
        <span key={name} className="inline-flex items-center gap-2 font-mono text-[11px] text-foreground/60">
          <Icon className="h-4 w-4" strokeWidth={1.5} />
          {name}
        </span>
      ))}
    </div>
  )
}

function WorldNote() {
  const [health, setHealth] = useState<Health>()
  useEffect(() => {
    api.health().then(setHealth).catch(() => {})
  }, [])
  if (health?.world !== "dev") return null
  return <p className="mt-4 text-center font-mono text-[11px] text-foreground/50">This build simulates World ID.</p>
}

/* ----------------------------------------------------------------- decks */

const problem: Slide = { label: "The problem", body: <ProblemEvidence /> }

const ARKIV_DECK: Slide[] = [
  { label: "Comment Desk", body: <Title tagline="A count anyone can rebuild." visual={<EntityGraph bare />} sponsor="arkiv" /> },
  problem,
  { label: "The record", body: <Stage title="Four entities. One public record."><EntityGraph /></Stage> },
  {
    label: "Key features",
    body: (
      <Stage title="Three Arkiv features. Three jobs.">
        <Features
          items={[
            { icon: Eye, name: "Public queries", effect: "Browser recount, no key" },
            { icon: Lock, name: "readonly", effect: "No comment can be edited" },
            { icon: Archive, name: "Arkiv + Swarm", effect: "The ruling, kept forever" },
          ]}
        />
      </Stage>
    ),
  },
  {
    label: "Why Arkiv",
    body: (
      <Stage title="What Postgres would take away.">
        <Compare
          against="Postgres"
          ours="Arkiv"
          rows={[
            ["The count", "Trust the operator", "Anyone rebuilds it"],
            ["A posted comment", "Admin can rewrite it", "Read-only, even for us"],
            ["Who published it", "Whatever the row says", "$creator, fixed forever"],
            ["Expiry", "A cron job, maybe forgotten", "Enforced by the chain"],
          ]}
        />
      </Stage>
    ),
  },
  { label: "Live recount", body: <LiveRecount /> },
]

const ENS_DECK: Slide[] = [
  { label: "Comment Desk", body: <Title tagline="ENS decides who can speak." visual={<NameTree bare />} sponsor="ens" /> },
  problem,
  { label: "Every name is real", body: <Stage title="Not a row. A name."><NameTree /></Stage> },
  { label: "The gate", body: <Stage title="No ENS, no comment."><EnsGate /></Stage> },
  {
    label: "Why ENSv2",
    body: (
      <Stage title="Permissions our server can't quietly widen.">
        <Compare
          against="A normal platform"
          ours="Comment Desk on ENSv2"
          rows={[
            ["An account", "Bought and sold", "Non-transferable name"],
            ["A moderator", "Usually full control", "One record, one docket"],
            ["The agent", "A flag in a database", "Its own resolvable name"],
            ["The case file", "Gone if the site goes", "Pointer kept on-chain"],
          ]}
        />
        <FeatureStrip
          items={[
            { icon: GitBranch, name: "Permissioned Registry" },
            { icon: KeyRound, name: "Permissioned Resolver" },
            { icon: ShieldCheck, name: "Enhanced Access Control" },
          ]}
        />
      </Stage>
    ),
  },
  { label: "Access control", body: <Stage title="One role. One field."><RoleSwitch /></Stage> },
]

const WORLD_DECK: Slide[] = [
  { label: "Comment Desk", body: <Title tagline="One human, one voice." visual={<div className="mx-auto max-w-[480px]"><Globe /></div>} sponsor="world" /> },
  problem,
  { label: "Who wrote it", body: <Stage title="The check matches the author."><CheckLadder /></Stage> },
  { label: "Bound to the words", body: <Stage title="A proof can't carry different text."><ProofBinding /></Stage> },
  {
    label: "Why World",
    body: (
      <Stage title="An agent can never post on its own.">
        <Compare
          against="One wallet, one vote"
          ours="Comment Desk with World"
          rows={[
            ["A bot farm", "Makes unlimited wallets", "Needs a unique human each"],
            ["An AI agent", "Posts whatever it wants", "Drafts only, human approves"],
            ["An old approval", "Often reusable", "Scoped to one exact draft"],
          ]}
        />
        <FeatureStrip
          items={[
            { icon: ScanFace, name: "Proof of Human" },
            { icon: UserCheck, name: "Selfie Check" },
            { icon: Fingerprint, name: "Nullifiers" },
            { icon: ShieldCheck, name: "Agent Pass" },
          ]}
        />
      </Stage>
    ),
  },
  {
    label: "Try to break it",
    body: (
      <Stage title="Try to get past it.">
        <BreakIt />
        <WorldNote />
      </Stage>
    ),
  },
]

const DECKS: Record<SponsorId, Slide[]> = { arkiv: ARKIV_DECK, ens: ENS_DECK, world: WORLD_DECK }
