"use client"

import { useState } from "react"
import { Bot, Check, FileText, Send, User, X } from "lucide-react"
import { keccak256, stringToHex } from "viem"
import { Hint, Press } from "./shared"

/* Who wrote the words decides how strong the check is. */

const FLOWS = {
  human: [
    { icon: User, name: "Human types" },
    { icon: Check, name: "World ID proof" },
    { icon: Send, name: "Posted" },
  ],
  agent: [
    { icon: Bot, name: "Agent drafts" },
    { icon: FileText, name: "Parked" },
    { icon: Check, name: "Human approves" },
    { icon: Send, name: "Posted" },
  ],
}

export function CheckLadder() {
  const [who, setWho] = useState<keyof typeof FLOWS>("agent")
  const [forced, setForced] = useState(false)
  const flow = FLOWS[who]
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-10 flex flex-wrap items-center gap-2">
        <Press active={who === "human"} onClick={() => { setWho("human"); setForced(false) }}>Human writes</Press>
        <Press active={who === "agent"} onClick={() => { setWho("agent"); setForced(false) }}>Agent writes</Press>
        {who === "agent" && (
          <span className="ml-auto">
            <Press onClick={() => setForced(true)} disabled={forced}>Let the agent post alone</Press>
          </span>
        )}
      </div>
      <div key={who} className="flex items-start justify-between gap-2">
        {flow.map((step, n) => {
          const Icon = step.icon
          const blocked = forced && who === "agent" && n >= 2
          return (
            <div key={step.name} className="contents">
              <div className="flex min-w-0 flex-1 flex-col items-center gap-3 text-center duration-500 animate-in fade-in" style={{ animationDelay: `${n * 120}ms`, animationFillMode: "both" }}>
                <span className={`flex h-16 w-16 items-center justify-center rounded-full border transition-colors sm:h-20 sm:w-20 ${blocked ? "border-dashed border-foreground/25 text-foreground/25" : "border-foreground bg-foreground text-background"}`}>
                  <Icon className="h-6 w-6 sm:h-7 sm:w-7" />
                </span>
                <span className={`font-display text-lg leading-tight sm:text-xl ${blocked ? "opacity-30" : ""}`}>{step.name}</span>
              </div>
              {n < flow.length - 1 && <span className="mt-8 h-px w-6 shrink bg-foreground/30 sm:mt-10 sm:w-12" />}
            </div>
          )
        })}
      </div>
      <div className="mt-8 min-h-[36px] text-center font-mono text-xs">
        {forced ? (
          <span className="border border-foreground px-3 py-2 duration-300 animate-in fade-in">Its only tool is save_draft. It can&apos;t post.</span>
        ) : (
          <Hint>{who === "human" ? "Typing it is the review" : "Nobody reviewed it yet, so a human must"}</Hint>
        )}
      </div>
    </div>
  )
}

/* The proof is bound to the words. Change one letter and watch the pattern break. */

function Pattern({ value, against }: { value: string; against?: string }) {
  const cells = value.slice(2, 66).split("")
  return (
    <div className="grid w-full gap-[2px]" style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }} aria-hidden="true">
      {cells.map((cell, n) => {
        const level = parseInt(cell, 16) / 15
        const differs = against !== undefined && against[n + 2] !== cell
        return <span key={n} className={`aspect-square ${differs ? "outline outline-1 outline-foreground" : ""}`} style={{ backgroundColor: `color-mix(in oklch, var(--foreground) ${Math.round(level * 100)}%, transparent)` }} />
      })}
    </div>
  )
}

const ORIGINAL = "Phase the rule in over three years."

export function ProofBinding() {
  const [text, setText] = useState(ORIGINAL)
  const [proved, setProved] = useState<string | null>(null)
  const hash = keccak256(stringToHex(text))
  const matches = proved === hash
  return (
    <div className="grid items-center gap-8 lg:grid-cols-2">
      <div>
        <Hint>The comment</Hint>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          aria-label="Comment text"
          className="mt-3 w-full resize-none border border-foreground/30 bg-transparent p-4 font-display text-2xl tracking-tight outline-none focus:border-foreground"
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Press onClick={() => setProved(hash)} active={!!proved && matches}>Sign proof with World ID</Press>
          {proved && (
            <span className="font-mono text-xs duration-300 animate-in fade-in">{matches ? "Bound to these words" : "Edit the text to break it"}</span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-5">
        <div>
          <Hint>Proof</Hint>
          <div className="mt-3">{proved ? <Pattern value={proved} /> : <div className="aspect-square border border-dashed border-foreground/25" />}</div>
        </div>
        <div>
          <Hint>Words now</Hint>
          <div className="mt-3"><Pattern value={hash} against={proved ?? undefined} /></div>
        </div>
        <div className={`col-span-2 flex items-center justify-center gap-2 border p-3 font-mono text-xs transition-colors ${!proved ? "border-foreground/20 text-foreground/40" : matches ? "border-foreground bg-foreground text-background" : "border-foreground"}`}>
          {!proved ? "Waiting for a proof" : matches ? <><Check className="h-3.5 w-3.5" /> Accepted</> : <><X className="h-3.5 w-3.5" /> Refused: words changed</>}
        </div>
      </div>
    </div>
  )
}

/* Every way in that should fail, one press each. */

const ATTACKS = [
  ["Comment twice on a topic", "Nullifier reused"],
  ["Cancel in World App", "Nothing posts"],
  ["Let the approval expire", "Draft discarded"],
  ["Rewrite the draft mid-approval", "Hash mismatch"],
  ["Replay an old approval", "Single-use"],
  ["Use a second wallet", "Same human, same name"],
] as const

export function BreakIt() {
  const [tried, setTried] = useState<Set<number>>(new Set())
  return (
    <div className="mx-auto max-w-4xl">
      <div className="grid grid-cols-1 gap-px border border-foreground/15 bg-foreground/15 sm:grid-cols-2 lg:grid-cols-3">
        {ATTACKS.map(([attack, result], n) => {
          const done = tried.has(n)
          return (
            <button
              key={attack}
              onClick={() => setTried((value) => new Set(value).add(n))}
              aria-pressed={done}
              className={`flex min-h-[120px] flex-col justify-between gap-3 p-5 text-left transition-colors duration-300 ${done ? "bg-foreground text-background" : "bg-background hover:bg-foreground/5"}`}
            >
              <span className="font-display text-xl leading-tight">{attack}</span>
              <span className="inline-flex items-center gap-2 font-mono text-[11px]">
                {done ? <><X className="h-3 w-3" /> {result}</> : <span className="text-foreground/40">Try it</span>}
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-6 text-center font-display text-3xl tabular-nums tracking-tight">{tried.size} tried · 0 got through</p>
    </div>
  )
}
