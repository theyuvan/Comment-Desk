"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { ArrowLeft, ArrowRight, Check, Maximize, Minimize, Minus } from "lucide-react"
import { api, type Health, type Stats } from "@/lib/api"

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

  // Deep links: /pitch?for=ens#3 opens slide 3 of the ENS deck.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("for")
    const id = isSponsor(requested) ? requested : "arkiv"
    setSponsor(id)
    const fromHash = Number(window.location.hash.slice(1))
    if (fromHash >= 1 && fromHash <= DECKS[id].length) setIndex(fromHash - 1)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      // Arrow keys belong to the dropdown while it has focus.
      if (event.target instanceof HTMLSelectElement) return
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

function Headline({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-8 font-display leading-[1.02] tracking-tight" style={{ fontSize: "clamp(2.25rem, 5vw, 4rem)" }}>
      {children}
    </h2>
  )
}

function Grid({ className, children }: { className: string; children: ReactNode }) {
  return <div className={`grid gap-px border border-foreground/15 bg-foreground/15 ${className}`}>{children}</div>
}

function Cell({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`min-w-0 bg-background p-5 sm:p-6 ${className}`}>{children}</div>
}

function Closing({ children }: { children: ReactNode }) {
  return <p className="mt-8 max-w-2xl text-sm leading-relaxed text-foreground/60">{children}</p>
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto border border-foreground/15">
      <table className="w-full min-w-[620px] text-sm">
        <thead>
          <tr className="border-b border-foreground/15 text-left font-mono text-[11px] text-foreground/50">
            {head.map((item) => (
              <th key={item} className="p-3 font-normal sm:p-4">
                {item}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, n) => (
            <tr key={n} className="border-b border-foreground/15 last:border-b-0">
              {row.map((cell, m) => (
                <td key={m} className={`p-3 sm:p-4 ${m === 0 ? "" : "text-foreground/70"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const Yes = () => <Check className="h-4 w-4" aria-label="Allowed" />
const No = () => <Minus className="h-4 w-4 text-foreground/30" aria-label="Blocked" />

function Title({ tagline, description, points }: { tagline: string; description: string; points: [string, string][] }) {
  return (
    <div className="text-center">
      <div className="mb-8 font-mono text-[10px] uppercase tracking-widest text-foreground/50">[ ETHGlobal Mumbai · November 2026 ]</div>
      <h1 className="font-display leading-none tracking-tight" style={{ fontSize: "clamp(3.25rem, 11vw, 9rem)" }}>
        Comment Desk
      </h1>
      <p className="mt-8 font-display text-2xl tracking-tight md:text-4xl">{tagline}</p>
      <p className="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-foreground/60">{description}</p>
      <Grid className="mx-auto mt-12 max-w-4xl grid-cols-1 text-left md:grid-cols-3">
        {points.map(([name, detail]) => (
          <Cell key={name} className="text-xs leading-relaxed">
            <span className="font-semibold">{name}</span> <span className="text-foreground/60">{detail}</span>
          </Cell>
        ))}
      </Grid>
    </div>
  )
}

function Problem({ gap }: { gap: ReactNode }) {
  const cases = [
    ["18M of 22M", "FCC, 2017", "Comments on the net-neutrality docket that were fake."],
    ["20,000", "CiviClick", "AI-written comments sent to a California air board, using real residents' identities without consent."],
    ["37,000", "Washington State", "Fake AI comments, with the same names reused 50–100 times a night."],
  ]
  return (
    <div>
      <Headline>AI made fake public input free.</Headline>
      <Grid className="grid-cols-1 md:grid-cols-3">
        {cases.map(([stat, source, detail]) => (
          <Cell key={source}>
            <div className="font-display text-4xl tracking-tight sm:text-5xl">{stat}</div>
            <div className="mt-4 text-sm">{source}</div>
            <div className="mt-2 text-xs leading-relaxed text-foreground/60">{detail}</div>
          </Cell>
        ))}
      </Grid>
      <Closing>{gap}</Closing>
    </div>
  )
}

function Product() {
  const steps = [
    ["Open", "A community, DAO or regulator opens a docket: a question, topics and a deadline."],
    ["Comment", "One verified human, one counted comment per topic. They type it, or their agent drafts it."],
    ["Conclude", "At the deadline the creator publishes a ruling. A docket ends, it doesn't scroll away."],
    ["Recount", "Anyone can rebuild the tally from the public record."],
  ]
  return (
    <div>
      <Headline>
        A docket is a case,
        <br />
        not a feed.
      </Headline>
      <Grid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(([title, detail], n) => (
          <Cell key={title}>
            <div className="mb-3 font-mono text-xs text-foreground/40">0{n + 1}</div>
            <div className="mb-2 font-display text-2xl">{title}</div>
            <div className="text-xs leading-relaxed text-foreground/60">{detail}</div>
          </Cell>
        ))}
      </Grid>
    </div>
  )
}

function Cards({ items }: { items: [string, string, string][] }) {
  return (
    <Grid className="grid-cols-1 md:grid-cols-3">
      {items.map(([title, detail, result]) => (
        <Cell key={title} className="flex flex-col">
          <div className="mb-3 font-display text-2xl leading-tight">{title}</div>
          <div className="flex-1 text-xs leading-relaxed text-foreground/60">{detail}</div>
          <div className="mt-5 border-t border-foreground/15 pt-3 font-mono text-[11px] leading-relaxed text-foreground/70">{result}</div>
        </Cell>
      ))}
    </Grid>
  )
}

function useLive() {
  const [stats, setStats] = useState<Stats | null>()
  const [health, setHealth] = useState<Health>()
  useEffect(() => {
    let active = true
    api.stats().then((value) => active && setStats(value)).catch(() => active && setStats(null))
    api.health().then((value) => active && setHealth(value)).catch(() => {})
    return () => {
      active = false
    }
  }, [])
  return { stats, health }
}

function LiveRecord() {
  const { stats } = useLive()
  const cards: [number, string][] = stats
    ? [
        [stats.dockets, "dockets on Arkiv"],
        [stats.comments, "comments on record"],
        [stats.countedComments, "counted in tallies"],
        [stats.members, "members"],
      ]
    : []
  return (
    <div>
      <Headline>Read from Arkiv, right now.</Headline>
      {stats ? (
        <Grid className="grid-cols-2 lg:grid-cols-4">
          {cards.map(([value, label]) => (
            <Cell key={label}>
              <div className="font-display text-5xl tracking-tight sm:text-6xl">{value}</div>
              <div className="mt-3 text-sm text-foreground/70">{label}</div>
            </Cell>
          ))}
        </Grid>
      ) : (
        <p className="font-mono text-xs text-foreground/50">
          {stats === null ? "[ BACKEND OFFLINE ] Live numbers appear when the API is running." : "Loading live numbers…"}
        </p>
      )}
      <Closing>
        Rabdi testnet, chain 7794095. Includes test data.{" "}
        <Link href="/dockets" className="text-foreground underline underline-offset-4">
          Open a docket and press &quot;Recount this yourself&quot;
        </Link>{" "}
        to watch a browser rebuild the tally straight from Arkiv.
      </Closing>
    </div>
  )
}

function WorldStatus() {
  const { health } = useLive()
  if (health?.world !== "dev") return null
  return <p className="mt-4 font-mono text-[11px] text-foreground/50">This build simulates World ID. The real gates are on the integration branch.</p>
}

/* ----------------------------------------------------------------- decks */

const ARKIV_DECK: Slide[] = [
  {
    label: "Comment Desk",
    body: (
      <Title
        tagline="Public input you can recount yourself."
        description="Today a portal announces a number and you have to believe it. On Comment Desk the record lives on Arkiv, so anyone can rebuild the count."
        points={[
          ["Read-only", "a comment can't be edited after it posts, even by us"],
          ["On-chain expiry", "records leave on schedule, with no cron job"],
          ["Public queries", "anyone can read the record with no key"],
        ]}
      />
    ),
  },
  {
    label: "The problem",
    body: <Problem gap={<>The numbers sit in a private database where an admin can change any row. <span className="text-foreground">Nobody outside can check the count.</span></>} />,
  },
  { label: "What we built", body: <Product /> },
  {
    label: "How we use Arkiv",
    body: (
      <div>
        <Headline>Four entities. One public record.</Headline>
        <Table
          head={["Entity", "Holds", "Who can edit", "Expires"]}
          rows={[
            ["comment", "Text, topic, sentiment, author type", "Nobody: read-only", "At the docket's exact block"],
            ["docket", "Question, topics, deadline, status, ruling", "Publisher, on a signed request", "7 days after the deadline"],
            ["member", "ENS name, hashed wallet, World nullifier", "Nobody: read-only", "About 182 days, the maximum"],
            ["policy_acceptance", "Which policy, hash of the signature", "Nobody: read-only", "About 182 days, the maximum"],
          ]}
        />
        <Closing>People are identified by a hashed column. Raw wallets and raw signatures never reach Arkiv, because everything on it is public.</Closing>
      </div>
    ),
  },
  {
    label: "Arkiv features at work",
    body: (
      <div>
        <Headline>Every feature changes what people see.</Headline>
        <Table
          head={["Arkiv feature", "How we use it", "What people see"]}
          rows={[
            ["Public queries", "The browser reads Arkiv with no key", "A recount that matches the tally"],
            ["readonly flag", "Set on every comment at creation", "No comment can be edited"],
            ["$creator filter", "Every read is scoped to our publisher", "Copied entities can't enter a tally"],
            ["Block expiry", "Comments use the docket's expiry block", "Records leave on schedule"],
            ["Indexed filters", "Docket, topic, owner hash, nullifier", "Dockets, comments, one voice per topic"],
            ["Bytes columns", "Full comment and ruling text", "Text beyond the 128-byte string limit"],
          ]}
        />
      </div>
    ),
  },
  { label: "Live record", body: <LiveRecord /> },
  {
    label: "Why Arkiv",
    body: (
      <div>
        <Headline>What Postgres would take away.</Headline>
        <Table
          head={["", "Postgres", "Arkiv"]}
          rows={[
            ["The count", "Trust the operator's number", "Anyone can rebuild it"],
            ["A posted comment", "An admin can rewrite the row", "Read-only, even for us"],
            ["Who published it", "Whatever the row says", "$creator, fixed at creation"],
            ["Expiry", "A cron job that can be forgotten", "Enforced by the chain"],
          ]}
        />
        <Closing>
          When a case closes, the ruling and every comment move to Swarm as one case file, and the reference is saved on the docket entity.{" "}
          <span className="text-foreground">Live on Arkiv, permanent on Swarm.</span>
        </Closing>
      </div>
    ),
  },
]

const ENS_DECK: Slide[] = [
  {
    label: "Comment Desk",
    body: (
      <Title
        tagline="An identity that can't be sold."
        description="Fake public input works because accounts are cheap and permissions live on someone's server. We moved both to ENSv2."
        points={[
          ["Permissioned Registry", "one non-transferable name per verified human"],
          ["Permissioned Resolver", "each member and each docket has its own"],
          ["Enhanced Access Control", "a moderator can change exactly one field"],
        ]}
      />
    ),
  },
  {
    label: "The problem",
    body: <Problem gap={<>Accounts are cheap, and they can be bought. Moderator powers usually mean full control. <span className="text-foreground">Identity and permissions both need to live outside the platform.</span></>} />,
  },
  { label: "What we built", body: <Product /> },
  {
    label: "How we use ENS",
    body: (
      <div>
        <Headline>
          Not a row in our table.
          <br />A name you can resolve.
        </Headline>
        <div className="border border-foreground/15">
          {(
            [
              ["commentdesk.eth", "the platform", "Registry and root name"],
              ["maya.commentdesk.eth", "one verified human", "Non-transferable, with her own resolver"],
              ["agent.maya.commentdesk.eth", "her agent", "Separate from her own name"],
              ["truck-rule.maya.commentdesk.eth", "a case", "Its own resolver and registry"],
              ["comment-1.truck-rule.maya…", "one comment", "Owned by its author"],
            ] as const
          ).map(([name, role, detail], n) => (
            <div key={name} className="flex flex-col gap-1 border-b border-foreground/15 p-3 last:border-b-0 md:flex-row md:items-center md:justify-between md:gap-6 sm:px-5">
              <code className="min-w-0 break-all font-mono text-sm" style={{ paddingLeft: `${Math.min(n, 3) * 0.9}rem` }}>
                {name}
              </code>
              <span className="shrink-0 font-mono text-[11px] text-foreground/50 md:text-right">
                {role} · {detail}
              </span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    label: "ENSv2 features at work",
    body: (
      <div>
        <Headline>Three ENSv2 features. Three real jobs.</Headline>
        <Cards
          items={[
            ["Permissioned Registry", "Member names withhold ROLE_CAN_TRANSFER_ADMIN. Member and docket registries give the operator only register and renew, the same model as .eth. Each registry links back with setParent.", "A verified identity can't be sold"],
            ["Permissioned Resolver", "Each member owns a resolver the operator has no role on. Each docket has its own, so one case's permissions can't touch another.", "We can't repoint a member's name"],
            ["Enhanced Access Control", "Roles are scoped to a single record key. All grants happen in one deployment transaction, and nobody holds text admin afterwards.", "Nobody can widen their own access"],
          ]}
        />
      </div>
    ),
  },
  {
    label: "Who can write what",
    body: (
      <div>
        <Headline>The moderator changes one field. That's it.</Headline>
        <Table
          head={["On a docket", "Creator", "Operator", "Moderator"]}
          rows={[
            ["Title, topics, deadline", <Yes key="a" />, <No key="b" />, <No key="c" />],
            ["Status", <Yes key="a" />, <Yes key="b" />, <Yes key="c" />],
            ["Comment records", <No key="a" />, <Yes key="b" />, <No key="c" />],
            ["Widen anyone's access", <No key="a" />, <No key="b" />, <No key="c" />],
          ]}
        />
        <Closing>
          The full flow passes 57 steps on live Sepolia contracts, and 23 of them are attacks that must fail. Comment names can't be sold, redirected or deleted.
        </Closing>
      </div>
    ),
  },
  {
    label: "Why ENSv2",
    body: (
      <div>
        <Headline>Permissions our server can't quietly widen.</Headline>
        <Table
          head={["", "A normal platform", "Comment Desk on ENSv2"]}
          rows={[
            ["An account", "Can be bought and sold", "Non-transferable name"],
            ["A moderator", "Usually gets full control", "One record on one docket"],
            ["The agent", "A flag in a database", "Its own resolvable name"],
            ["The case file", "Gone if the site goes", "Pointer kept on the docket's name"],
          ]}
        />
        <Closing>
          Live on Sepolia. See{" "}
          <a href="https://sepolia.app.ens.domains/commentdesk.eth" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">
            commentdesk.eth in the ENS app
          </a>
          .
        </Closing>
      </div>
    ),
  },
]

const WORLD_DECK: Slide[] = [
  {
    label: "Comment Desk",
    body: (
      <Title
        tagline="One human, one voice. Even with AI."
        description="We don't ban agents. We make sure a real human stands behind every word that becomes public."
        points={[
          ["World ID", "one unique human, without revealing who"],
          ["IDKit", "a fresh proof bound to the exact words"],
          ["Agent Pass", "agents draft, and only humans approve"],
        ]}
      />
    ),
  },
  {
    label: "The problem",
    body: <Problem gap={<>In every case the portal asked whether a submission arrived. It never asked <span className="text-foreground">whether a real, unique human sent it.</span></>} />,
  },
  { label: "What we built", body: <Product /> },
  {
    label: "How we use World",
    body: (
      <div>
        <Headline>The check matches who wrote the words.</Headline>
        <Table
          head={["Moment", "Check", "Why this check"]}
          rows={[
            ["Joining", "IDKit uniqueness proof", "One human gets one name, and verifying again just signs them back in"],
            ["A human types a comment", "IDKit proof at submit", "Typing it is the review, so one check fits the risk"],
            ["An agent drafts a comment", "World ID Agent Pass step-up", "Nobody reviewed it yet, so a fresh approval of the exact text is required"],
          ]}
        />
        <Closing>
          Dockets set the level: strict needs Proof of Human, soft takes a Selfie Check. Our built-in agent interviews the member and has one tool,{" "}
          <span className="text-foreground">save_draft, so it literally can't post.</span>
        </Closing>
      </div>
    ),
  },
  {
    label: "Bound to the exact words",
    body: (
      <div>
        <Headline>A proof can't carry different text.</Headline>
        <Cards
          items={[
            ["The server decides", "The backend chooses the action, signal and credential, and signs the request. The browser only carries the proof.", "The client can't change the rules"],
            ["The words are bound", "The signal covers the exact text and position. The text posted is the copy stored when the request was issued.", "No swapping words after proving"],
            ["One voice per topic", "Each docket and topic is its own action, so the nullifier repeats if the same human tries again.", "A second comment is refused"],
          ]}
        />
      </div>
    ),
  },
  {
    label: "Denied paths",
    body: (
      <div>
        <Headline>When it fails, nothing posts.</Headline>
        <Table
          head={["What happens", "Result"]}
          rows={[
            ["The member cancels in World App", "Blocked, and the member sees why"],
            ["The same human comments twice on a topic", "Refused: nullifier reused"],
            ["The Agent Pass confirm expires", "The draft is discarded"],
            ["The agent rewrites the draft during approval", "Discarded: the approved hash no longer matches"],
            ["The approval is replayed", "Refused: each one is single-use"],
          ]}
        />
      </div>
    ),
  },
  {
    label: "Why World",
    body: (
      <div>
        <Headline>An agent can never post on its own.</Headline>
        <Table
          head={["", "One wallet, one vote", "Comment Desk with World"]}
          rows={[
            ["A bot farm", "Makes as many wallets as it likes", "Needs a unique human for each voice"],
            ["An AI agent", "Posts whatever it wants", "Drafts only, and a human approves"],
            ["An old approval", "Often reusable", "Scoped to one exact draft"],
          ]}
        />
        <Closing>
          The matching principle: <span className="text-foreground">the check gets stronger as the words move further from direct human judgment.</span>
        </Closing>
        <WorldStatus />
      </div>
    ),
  },
]

const DECKS: Record<SponsorId, Slide[]> = { arkiv: ARKIV_DECK, ens: ENS_DECK, world: WORLD_DECK }
