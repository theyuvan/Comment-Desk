"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { ArrowLeft, ArrowRight, Check, Maximize, Minimize, Minus } from "lucide-react"

const SLIDES = [
  "Comment Desk",
  "The problem",
  "What we built",
  "Two gates",
  "A name for everything",
  "Live numbers",
  "Why it's different",
]

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ""

export default function PitchPage() {
  const [index, setIndex] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const deck = useRef<HTMLDivElement>(null)
  const last = SLIDES.length - 1

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
      window.history.replaceState(null, "", `#${next + 1}`)
    },
    [last],
  )

  // Deep links: /pitch#3 opens slide 3.
  useEffect(() => {
    const fromHash = Number(window.location.hash.slice(1))
    if (fromHash >= 1 && fromHash <= SLIDES.length) setIndex(fromHash - 1)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
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

  return (
    <div className="flex h-dvh flex-col bg-foreground text-background">
      <header className="shrink-0 border-b border-background/10">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between px-4 py-4 sm:px-8">
          <Link href="/" className="font-display text-xl tracking-tight">
            Comment Desk
          </Link>
          <nav className="flex items-center gap-5 font-mono text-xs text-background/50">
            <span className="text-background">Pitch</span>
            <Link href="/" className="transition-colors hover:text-background">
              Home
            </Link>
          </nav>
        </div>
      </header>

      <div ref={deck} className="flex min-h-0 flex-1 flex-col bg-foreground text-background">
        <main className="flex min-h-0 flex-1 overflow-y-auto">
          <div
            key={index}
            className="m-auto w-full max-w-[1180px] px-4 py-8 duration-500 animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none sm:px-8"
          >
            {index === 0 && <TitleSlide />}
            {index === 1 && <ProblemSlide />}
            {index === 2 && <SolutionSlide />}
            {index === 3 && <GatesSlide />}
            {index === 4 && <NamesSlide />}
            {index === 5 && <NumbersSlide />}
            {index === 6 && <DifferentSlide />}
          </div>
        </main>

        <footer className="shrink-0 border-t border-background/10">
          <div className="mx-auto flex max-w-[1180px] items-center gap-3 px-4 py-3 sm:gap-4 sm:px-8">
            <button
              onClick={() => go(index - 1)}
              disabled={index === 0}
              aria-label="Previous slide"
              className="border border-background/20 p-2 transition-colors hover:border-background disabled:opacity-30"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1.5">
              {SLIDES.map((slide, n) => (
                <button
                  key={slide}
                  onClick={() => go(n)}
                  aria-label={`Slide ${n + 1}: ${slide}`}
                  aria-current={n === index ? "true" : undefined}
                  className={`h-2 transition-all ${
                    n === index ? "w-8 bg-background" : "w-2 bg-background/20 hover:bg-background/50"
                  }`}
                />
              ))}
            </div>
            <button
              onClick={() => go(index + 1)}
              disabled={index === last}
              aria-label="Next slide"
              className="border border-background/20 p-2 transition-colors hover:border-background disabled:opacity-30"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
            <span className="ml-auto hidden font-mono text-[10px] uppercase tracking-widest text-background/40 sm:inline">
              ← → to move · F for fullscreen
            </span>
            <button
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              className="ml-auto border border-background/20 p-2 text-background/60 transition-colors hover:border-background hover:text-background sm:ml-0"
            >
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function Kicker({ n, label }: { n: number; label: string }) {
  return (
    <div className="mb-5 font-mono text-[10px] uppercase tracking-widest text-background/50">
      [ {String(n).padStart(2, "0")} / {String(SLIDES.length).padStart(2, "0")} · {label} ]
    </div>
  )
}

function Headline({ children }: { children: ReactNode }) {
  return (
    <h2
      className="mb-8 font-display leading-[1.02] tracking-tight"
      style={{ fontSize: "clamp(2.25rem, 5vw, 4rem)" }}
    >
      {children}
    </h2>
  )
}

function Grid({ className, children }: { className: string; children: ReactNode }) {
  return <div className={`grid gap-px border border-background/15 bg-background/15 ${className}`}>{children}</div>
}

function Cell({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`min-w-0 bg-foreground p-5 sm:p-6 ${className}`}>{children}</div>
}

function TitleSlide() {
  const stack = [
    ["World ID", "one real, unique human behind every comment"],
    ["ENSv2", "every member, docket and comment is a name you can resolve"],
    ["Arkiv + Swarm", "a live record anyone can recount, then a permanent case file"],
  ]
  return (
    <div className="text-center">
      <div className="mb-8 font-mono text-[10px] uppercase tracking-widest text-background/50">
        [ ETHGlobal Mumbai · November 2026 ]
      </div>
      <h1 className="font-display leading-none tracking-tight" style={{ fontSize: "clamp(3.25rem, 11vw, 9rem)" }}>
        Comment Desk
      </h1>
      <p className="mt-8 font-display text-2xl tracking-tight md:text-4xl">Public input you can recount yourself.</p>
      <p className="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-background/60">
        It feels like Reddit. But every post is tied to one real human, every thread concludes with a published
        ruling, and the full record stays queryable by anyone, independent of us.
      </p>
      <Grid className="mx-auto mt-12 max-w-4xl grid-cols-1 text-left md:grid-cols-3">
        {stack.map(([name, description]) => (
          <Cell key={name} className="text-xs leading-relaxed">
            <span className="font-semibold">{name}</span> <span className="text-background/60">{description}</span>
          </Cell>
        ))}
      </Grid>
    </div>
  )
}

function ProblemSlide() {
  const cases = [
    [
      "20,000",
      "CiviClick",
      "AI-written comments sent to a Southern California air board, using real residents' identities without consent. The board voted 7-5 afterward.",
    ],
    ["37,000", "Washington State", "Fake AI comments received, with the same names reused 50–100 times a night."],
    ["18M of 22M", "FCC, 2017", "Comments on the net-neutrality docket that were fake."],
  ]
  return (
    <div>
      <Kicker n={2} label="The problem" />
      <Headline>AI made fake public input free.</Headline>
      <Grid className="grid-cols-1 md:grid-cols-3">
        {cases.map(([stat, source, description]) => (
          <Cell key={source}>
            <div className="font-display text-4xl tracking-tight sm:text-5xl">{stat}</div>
            <div className="mt-4 text-sm">{source}</div>
            <div className="mt-2 text-xs leading-relaxed text-background/60">{description}</div>
          </Cell>
        ))}
      </Grid>
      <p className="mt-8 max-w-2xl text-sm leading-relaxed text-background/60">
        In every case the portal only asked whether a submission arrived. It never asked{" "}
        <span className="text-background">whether a real, unique human was behind it.</span> DAOs carry the same
        weakness: one wallet, one voice is not one human.
      </p>
    </div>
  )
}

function SolutionSlide() {
  const steps = [
    ["Open", "A community, DAO or regulator opens a docket: a question, topics and a deadline."],
    ["Verify", "Members join once with World ID and get a resolvable ENS name."],
    ["Comment", "One counted comment per human, per topic. Humans type it, or their agent drafts it."],
    ["Recount", "The tally lives on Arkiv. Anyone can re-derive it without our backend."],
    ["Conclude", "At the deadline the creator publishes a ruling. A docket ends, it doesn't scroll away."],
    ["Archive", "The ruling and full record move to Swarm as the permanent case file."],
  ]
  return (
    <div>
      <Kicker n={3} label="What we built" />
      <Headline>
        A docket is a case,
        <br />
        not a feed.
      </Headline>
      <Grid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map(([title, description], n) => (
          <Cell key={title}>
            <div className="mb-3 font-mono text-xs text-background/40">0{n + 1}</div>
            <div className="mb-2 font-display text-2xl">{title}</div>
            <div className="text-xs leading-relaxed text-background/60">{description}</div>
          </Cell>
        ))}
      </Grid>
    </div>
  )
}

function GatesSlide() {
  const gates = [
    {
      title: "A human typed it",
      check: "World ID check",
      body: "Writing it was already the human's own review, so one proof of personhood is proportionate.",
      denied: "Cancelled proof, or already commented on this topic: blocked, and the member sees why.",
    },
    {
      title: "An agent drafted it",
      check: "Agent Pass confirm",
      body: "Nobody reviewed the draft the way typing reviews it, so a fresh confirm is scoped to the exact text.",
      denied: "Confirm expired, or the draft changed after approval: discarded, and nothing posts.",
    },
  ]
  return (
    <div>
      <Kicker n={4} label="Two gates" />
      <Headline>The check matches who wrote the words.</Headline>
      <Grid className="grid-cols-1 md:grid-cols-2">
        {gates.map((gate) => (
          <Cell key={gate.title}>
            <div className="font-display text-3xl tracking-tight">{gate.title}</div>
            <div className="mt-2 font-mono text-xs text-background/50">{gate.check}</div>
            <p className="mt-5 text-sm leading-relaxed text-background/70">{gate.body}</p>
            <p className="mt-5 border-t border-background/15 pt-4 font-mono text-[11px] leading-relaxed text-background/50">
              {gate.denied}
            </p>
          </Cell>
        ))}
      </Grid>
      <p className="mt-8 max-w-2xl text-sm leading-relaxed text-background/60">
        An agent can never submit on its own.{" "}
        <span className="text-background">It cannot quietly resubmit a different draft under an old approval.</span>
      </p>
    </div>
  )
}

function NamesSlide() {
  const chain = [
    ["maya.commentdesk.eth", "the member", "One per verified human, and it can never be sold"],
    ["truck-rule.maya.commentdesk.eth", "their docket", "Its own Permissioned Resolver, with access split by record"],
    ["comment-1.truck-rule.maya.commentdesk.eth", "one comment", "A real name, owned by the person who wrote it"],
  ]
  return (
    <div>
      <Kicker n={5} label="A name for everything" />
      <Headline>
        Not a row in our table.
        <br />A name you can resolve.
      </Headline>
      <div className="border border-background/15">
        {chain.map(([name, role, detail], n) => (
          <div
            key={name}
            className="flex flex-col gap-1 border-b border-background/15 p-4 last:border-b-0 md:flex-row md:items-center md:justify-between md:gap-6 sm:p-5"
          >
            <code className="min-w-0 break-all font-mono text-sm" style={{ paddingLeft: `${n * 1.25}rem` }}>
              {name}
            </code>
            <span className="shrink-0 font-mono text-[11px] text-background/50 md:text-right">
              {role} · {detail}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-8 max-w-2xl text-sm leading-relaxed text-background/60">
        ENSv2 makes this practical. A moderator gets Enhanced Access Control rights to edit{" "}
        <span className="text-background">only the status record</span> of a docket, never the name or its other
        records. An agent can hold its own child name, so human and agent authorship stay distinct.
      </p>
    </div>
  )
}

type Stats = { members: number; dockets: number; comments: number; countedComments: number }

function NumbersSlide() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    fetch(`${API_URL}/api/stats`)
      .then((response) => {
        if (!response.ok) throw new Error("stats unavailable")
        return response.json() as Promise<Stats>
      })
      .then((result) => {
        if (active) setStats(result)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [])

  const cards: [string, string][] = stats
    ? [
        [String(stats.members), "verified members"],
        [String(stats.dockets), "dockets opened"],
        [String(stats.comments), "comments on record"],
        [String(stats.countedComments), "counted in the tally"],
      ]
    : []

  return (
    <div>
      <Kicker n={6} label="Live numbers" />
      <Headline>Read from Arkiv, right now.</Headline>
      {stats ? (
        <>
          <Grid className="grid-cols-2 lg:grid-cols-4">
            {cards.map(([value, label]) => (
              <Cell key={label}>
                <div className="font-display text-5xl tracking-tight sm:text-6xl">{value}</div>
                <div className="mt-3 text-sm text-background/70">{label}</div>
              </Cell>
            ))}
          </Grid>
          <p className="mt-6 font-mono text-[11px] text-background/50">Source: Arkiv Rabdi testnet, chain 7794095</p>
        </>
      ) : (
        <p className="font-mono text-xs text-background/50">
          {failed ? "[ BACKEND OFFLINE ] Live numbers appear when the API is running." : "Loading live numbers…"}
        </p>
      )}
    </div>
  )
}

function DifferentSlide() {
  const rows: [string, boolean, boolean, boolean][] = [
    ["One real, unique human per voice", false, false, true],
    ["A deadline and a published conclusion", false, true, true],
    ["Anyone can recount the tally", false, false, true],
    ["Agent drafts gated by a fresh human confirm", false, false, true],
    ["Record outlives the platform", false, false, true],
  ]
  return (
    <div>
      <Kicker n={7} label="Why it's different" />
      <Headline>Anyone can check the count.</Headline>
      <div className="overflow-x-auto border border-background/15">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-background/15 font-mono text-[11px] text-background/50">
              <th className="p-4 text-left font-normal">
                <span className="sr-only">Capability</span>
              </th>
              <th className="p-4 font-normal">Social feed</th>
              <th className="p-4 font-normal">Comment portal</th>
              <th className="p-4 font-normal text-background">Comment Desk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, ...values]) => (
              <tr key={label} className="border-b border-background/15 last:border-b-0">
                <td className="p-4 text-background/80">{label}</td>
                {values.map((has, n) => (
                  <td key={n} className="p-4 text-center">
                    {has ? (
                      <Check className="mx-auto h-4 w-4" aria-label="Yes" />
                    ) : (
                      <Minus className="mx-auto h-4 w-4 text-background/30" aria-label="No" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-8 max-w-2xl font-display text-2xl leading-snug tracking-tight">
        Every voice is a real human. Every count is yours to check.
      </p>
    </div>
  )
}
