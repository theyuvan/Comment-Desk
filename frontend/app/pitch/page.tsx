"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Eye,
  FileText,
  Filter,
  Fingerprint,
  GitBranch,
  Globe2,
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
import { EntityGraph, ExpiryDial, LiveRecount, TamperTest } from "@/components/pitch/arkiv"
import { EnsGate, NameTree, RoleSwitch } from "@/components/pitch/ens"
import { BreakIt, CheckLadder, ProofBinding } from "@/components/pitch/world"
import { Big, Flood, Journey } from "@/components/pitch/shared"
import { Globe } from "@/components/pitch/globe"

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
      <div className="page-lines" aria-hidden="true" />
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
          </nav>
        </div>
      </header>

      <div ref={deck} className="relative z-10 flex min-h-0 flex-1 flex-col bg-background text-foreground">
        <div className="page-lines" aria-hidden="true" />
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
            <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-foreground/50">
              <span>Pitch for</span>
              <select
                value={sponsor}
                onChange={(event) => choose(event.target.value as SponsorId)}
                className="border border-foreground/30 bg-background px-2 py-1.5 font-mono text-xs normal-case tracking-normal text-foreground transition-colors hover:border-foreground"
              >
                {SPONSORS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
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

function Title({ tagline, visual }: { tagline: string; visual: ReactNode }) {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-[1fr_1.2fr]">
      <div>
        <div className="mb-6 font-mono text-[10px] uppercase tracking-widest text-foreground/50">[ ETHGlobal Mumbai · November 2026 ]</div>
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
    <div className="grid grid-cols-2 gap-px border border-foreground/15 bg-foreground/15 lg:grid-cols-3">
      {items.map(({ icon: Icon, name, effect }) => (
        <div key={name} className="group bg-background p-5 transition-colors duration-300 hover:bg-foreground hover:text-background sm:p-7">
          <Icon className="h-6 w-6" strokeWidth={1.5} />
          <div className="mt-6 font-display text-xl leading-tight sm:text-2xl">{name}</div>
          <div className="mt-2 font-mono text-[11px] leading-relaxed opacity-60">{effect}</div>
        </div>
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

const problem: Slide = { label: "The problem", body: <Flood /> }

const ARKIV_DECK: Slide[] = [
  { label: "Comment Desk", body: <Title tagline="A count anyone can rebuild." visual={<EntityGraph bare />} /> },
  problem,
  {
    label: "The case",
    body: (
      <Stage title="A docket is a case, not a feed.">
        <Journey marks={{ Open: "Docket entity created", Comment: "Readonly. No edits, ever", Conclude: "Ruling patched in, signed", Recount: "Anyone, no key" }} />
      </Stage>
    ),
  },
  { label: "The record", body: <Stage title="Four entities. One public record."><EntityGraph /></Stage> },
  {
    label: "Key features",
    body: (
      <Stage title="Six Arkiv features. Six jobs.">
        <Features
          items={[
            { icon: Eye, name: "Public queries", effect: "Browser recount, no key" },
            { icon: Lock, name: "readonly", effect: "No comment can be edited" },
            { icon: Fingerprint, name: "$creator", effect: "Copies can't enter a tally" },
            { icon: Clock, name: "Block expiry", effect: "Records leave on schedule" },
            { icon: Filter, name: "Indexed filters", effect: "One voice per topic" },
            { icon: FileText, name: "Bytes columns", effect: "Full comment text" },
          ]}
        />
      </Stage>
    ),
  },
  { label: "Readonly", body: <Stage title="Try to change a comment."><TamperTest /></Stage> },
  { label: "Expiry", body: <Stage title="Data with a deadline."><ExpiryDial /></Stage> },
  { label: "Live recount", body: <LiveRecount /> },
]

const ENS_DECK: Slide[] = [
  { label: "Comment Desk", body: <Title tagline="ENS decides who can speak." visual={<NameTree bare />} /> },
  problem,
  {
    label: "The case",
    body: (
      <Stage title="A docket is a case, not a feed.">
        <Journey marks={{ Open: "Its own registry and resolver", Comment: "ENS checks, then Arkiv records", Conclude: "Status record flips", Recount: "Name points to the record" }} />
      </Stage>
    ),
  },
  { label: "Every name is real", body: <Stage title="Not a row. A name."><NameTree /></Stage> },
  { label: "The gate", body: <Stage title="No ENS, no comment."><EnsGate /></Stage> },
  { label: "Access control", body: <Stage title="One role. One field."><RoleSwitch /></Stage> },
  {
    label: "Key features",
    body: (
      <Stage title="ENSv2 doing real work.">
        <Features
          items={[
            { icon: GitBranch, name: "Permissioned Registry", effect: "A registry per member and docket" },
            { icon: KeyRound, name: "Permissioned Resolver", effect: "Each docket holds its own rules" },
            { icon: ShieldCheck, name: "Enhanced Access Control", effect: "Roles scoped to one record" },
            { icon: Lock, name: "Non-transferable", effect: "An identity can't be sold" },
            { icon: UserCheck, name: "Agents as names", effect: "No agent.maya, no agent comment" },
            { icon: Globe2, name: "Universal Resolver", effect: "Rules read like any wallet would" },
          ]}
        />
      </Stage>
    ),
  },
]

const WORLD_DECK: Slide[] = [
  { label: "Comment Desk", body: <Title tagline="One human, one voice." visual={<div className="mx-auto max-w-[480px]"><Globe /></div>} /> },
  problem,
  {
    label: "The case",
    body: (
      <Stage title="A docket is a case, not a feed.">
        <Journey marks={{ Open: "Level set: Orb or Selfie", Comment: "One human, one voice per topic", Conclude: "A ruling, on the record", Recount: "Humans counted, not accounts" }} />
      </Stage>
    ),
  },
  { label: "Who wrote it", body: <Stage title="The check matches the author."><CheckLadder /></Stage> },
  { label: "Bound to the words", body: <Stage title="A proof can't carry different text."><ProofBinding /></Stage> },
  {
    label: "Key features",
    body: (
      <Stage title="World at every gate.">
        <Features
          items={[
            { icon: ScanFace, name: "Proof of Human", effect: "Strict dockets: Orb" },
            { icon: UserCheck, name: "Selfie Check", effect: "Soft dockets" },
            { icon: Fingerprint, name: "Nullifiers", effect: "One voice per topic" },
            { icon: KeyRound, name: "Server-issued requests", effect: "The client can't change rules" },
            { icon: ShieldCheck, name: "Agent Pass", effect: "Approve one exact draft" },
            { icon: Lock, name: "Signal binding", effect: "Proof tied to the text" },
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
