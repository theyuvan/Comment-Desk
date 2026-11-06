"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Bot, Lock, ShieldCheck, User, X } from "lucide-react"

export function Big({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-display leading-[1.02] tracking-tight" style={{ fontSize: "clamp(2.5rem, 5.5vw, 4.75rem)" }}>
      {children}
    </h2>
  )
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[11px] uppercase tracking-widest text-foreground/45">{children}</p>
}

export function Press({
  active,
  onClick,
  children,
  disabled,
}: {
  active?: boolean
  onClick: () => void
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`border px-3 py-2 font-mono text-xs transition-colors disabled:opacity-40 ${
        active ? "border-foreground bg-foreground text-background" : "border-foreground/30 hover:border-foreground"
      }`}
    >
      {children}
    </button>
  )
}

/* The CiviClick case, as a picture: a flood of forged comments, then the same flood through the gate. */

const CELLS = 400

export function Flood() {
  const [gated, setGated] = useState(false)
  const [filled, setFilled] = useState(0)

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setFilled(CELLS)
      return
    }
    setFilled(0)
    const started = performance.now()
    let frame = 0
    const step = (now: number) => {
      const done = Math.min(1, (now - started) / 1800)
      setFilled(Math.round(done * CELLS))
      if (done < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [gated])

  const count = Math.round((filled / CELLS) * 20000)
  return (
    <div className="grid items-center gap-8 lg:grid-cols-[1fr_1.1fr] lg:gap-14">
      <div>
        <Hint>CiviClick · Southern California air board</Hint>
        <div className="mt-5 font-display leading-none tracking-tight tabular-nums" style={{ fontSize: "clamp(3.5rem, 10vw, 7.5rem)" }}>
          {gated ? "0" : count.toLocaleString("en-US")}
        </div>
        <p className="mt-4 font-display text-2xl tracking-tight md:text-3xl">
          {gated ? "forged comments counted." : "AI comments. Real names. No consent."}
        </p>
        <div className="mt-7 flex gap-2">
          <Press active={!gated} onClick={() => setGated(false)}>Portal today</Press>
          <Press active={gated} onClick={() => setGated(true)}>Comment Desk</Press>
        </div>
      </div>
      <div
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: "repeat(25, minmax(0, 1fr))" }}
        role="img"
        aria-label={gated ? "A grid of forged comments, all rejected at the gate." : "A grid filling with forged comments."}
      >
        {Array.from({ length: CELLS }, (_, n) => {
          const on = n < filled
          return (
            <span
              key={n}
              className={`aspect-square transition-all duration-300 ${
                !on ? "bg-foreground/5" : gated ? "scale-50 rounded-full bg-foreground/15" : "bg-foreground"
              }`}
            />
          )
        })}
      </div>
    </div>
  )
}

/* The docket lifecycle as a track the presenter can step through. */

const JOURNEY = ["Open", "Comment", "Conclude", "Recount"] as const

export function Journey({ marks }: { marks: Record<(typeof JOURNEY)[number], string> }) {
  const [at, setAt] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    timer.current = setInterval(() => setAt((value) => (value + 1) % JOURNEY.length), 2200)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [])

  const pick = (n: number) => {
    if (timer.current) clearInterval(timer.current)
    setAt(n)
  }

  return (
    <div>
      <div className="relative grid grid-cols-4">
        <div className="absolute left-[12.5%] right-[12.5%] top-[27px] h-px bg-foreground/20" />
        <div
          className="absolute left-[12.5%] top-[27px] h-px bg-foreground transition-all duration-500"
          style={{ width: `${(at / 3) * 75}%` }}
        />
        {JOURNEY.map((step, n) => (
          <button key={step} onClick={() => pick(n)} aria-pressed={n === at} className="relative flex flex-col items-center gap-3">
            <span
              className={`flex h-14 w-14 items-center justify-center rounded-full border font-mono text-sm transition-all duration-300 ${
                n <= at ? "border-foreground bg-foreground text-background" : "border-foreground/25 bg-background text-foreground/50"
              } ${n === at ? "scale-110" : ""}`}
            >
              {n + 1}
            </span>
            <span className={`font-display text-xl transition-opacity md:text-2xl ${n === at ? "" : "opacity-50"}`}>{step}</span>
          </button>
        ))}
      </div>
      <div key={at} className="mt-10 text-center font-display text-2xl tracking-tight duration-300 animate-in fade-in md:text-3xl">
        {marks[JOURNEY[at]!]}
      </div>
    </div>
  )
}

/* Author chips used on both the World and ENS slides. */

export function Who({ kind }: { kind: "human" | "agent" }) {
  const Icon = kind === "human" ? User : Bot
  return (
    <span className="inline-flex items-center gap-1.5 border border-foreground/25 px-2 py-1 font-mono text-[11px]">
      <Icon className="h-3 w-3" />
      {kind}
    </span>
  )
}

export function Verdict({ ok, children }: { ok: boolean; children: ReactNode }) {
  const Icon = ok ? ShieldCheck : X
  return (
    <div className={`inline-flex items-center gap-2 border px-3 py-2 font-mono text-xs ${ok ? "border-foreground bg-foreground text-background" : "border-foreground/40"}`}>
      <Icon className="h-3.5 w-3.5" />
      {children}
    </div>
  )
}

export { Lock }
