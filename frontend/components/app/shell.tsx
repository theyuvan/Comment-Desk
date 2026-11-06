"use client"

import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { api, ensUrl, request, type Health, type Member } from "@/lib/api"
import { currentWallet, signAction } from "@/lib/wallet"
import { ThemeToggle } from "@/components/theme-toggle"
import { BuiltWith } from "@/components/visuals/sponsor-marks"

const MEMBER_CHANGED = "commentdesk:member-changed"

/** A passkey proves who this is, and this turns that into a session for the World routes. */
let restoring: Promise<void> | null = null
function ensureSession() {
  restoring ??= (async () => {
    const session = await request<{ memberRef: string } | null>("/api/session").catch(() => null)
    if (session) return
    const issuedAt = BigInt(Date.now())
    const signature = await signAction("SignIn", { issuedAt })
    await request("/api/session/wallet", { method: "POST", body: { issuedAt, signature } })
  })().finally(() => {
    restoring = null
  })
  return restoring
}

export function useMember() {
  const [member, setMember] = useState<Member | null>()
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      if (timer) clearTimeout(timer)
      const wallet = currentWallet()
      const found = wallet ? await api.member(wallet.address).catch(() => null) : null
      if (found) await ensureSession().catch(() => {})
      if (!active) return
      setMember(found)
      // The ENS name is minted after joining; look again until it lands.
      if (found?.nameStatus === "creating") timer = setTimeout(load, 4000)
    }
    load()
    window.addEventListener(MEMBER_CHANGED, load)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
      window.removeEventListener(MEMBER_CHANGED, load)
    }
  }, [])
  // Tells every useMember on the page, so the header updates along with the form.
  const refresh = () => window.dispatchEvent(new Event(MEMBER_CHANGED))
  return { member, refresh }
}

export function useHealth() {
  const [health, setHealth] = useState<Health | null>()
  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null))
  }, [])
  return health
}

export function EnsLink({ name, className = "" }: { name: string; className?: string }) {
  return (
    <a
      href={ensUrl(name)}
      target="_blank"
      rel="noreferrer"
      className={`break-all font-mono underline decoration-foreground/20 underline-offset-4 transition-colors hover:decoration-foreground ${className}`}
    >
      {name}
    </a>
  )
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "error" }) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={`border px-4 py-3 text-sm leading-relaxed ${
        tone === "error" ? "border-destructive/40 text-destructive" : "border-foreground/15 text-muted-foreground"
      }`}
    >
      {children}
    </div>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="mb-3 font-mono text-xs text-muted-foreground">{children}</div>
}

/** World, Arkiv and ENS: the three real services a wait is usually for. */
function LoadingMarks() {
  const marks = [
    { label: "World", path: "M12 2a10 10 0 100 20 10 10 0 000-20Zm0 0c2.5 2.5 3.8 5.8 3.8 10S14.5 19.5 12 22M12 2C9.5 4.5 8.2 7.8 8.2 12S9.5 19.5 12 22M3 9h18M3 15h18" },
    { label: "Arkiv", path: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" },
    { label: "ENS", path: "M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 0v20M3 7l9 5 9-5" },
  ]
  return (
    <span className="inline-flex items-center gap-2" aria-hidden="true">
      {marks.map(({ label, path }, index) => (
        <svg
          key={label}
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5 animate-pulse text-muted-foreground motion-reduce:animate-none"
          style={{ animationDelay: `${index * 220}ms`, animationDuration: "1.3s" }}
        >
          <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ))}
    </span>
  )
}

export function Loading({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 text-sm text-muted-foreground" role="status">
      <LoadingMarks />
      <span className="animate-pulse motion-reduce:animate-none">{children}</span>
    </p>
  )
}

/** A short progress list, so a multi-step action never looks stuck. */
export function Steps({ steps, active }: { steps: string[]; active: number }) {
  return (
    <ol className="grid gap-px border border-foreground/15 bg-foreground/15 sm:grid-flow-col sm:auto-cols-fr">
      {steps.map((step, index) => (
        <li
          key={step}
          aria-current={index === active ? "step" : undefined}
          className={`bg-background px-3 py-2.5 text-xs ${index === active ? "text-foreground" : "text-muted-foreground"}`}
        >
          <span className="font-mono">{index < active ? "✓" : `0${index + 1}`}</span> {step}
        </li>
      ))}
    </ol>
  )
}

function Banner({ health }: { health: Health | null | undefined }) {
  if (health === null) {
    return (
      <div className="border-b border-destructive/30 px-6 py-2 text-center text-sm text-destructive" role="alert">
        Comment Desk can&apos;t be reached right now, so this page can&apos;t load.
      </div>
    )
  }
  if (health?.mode === "memory") {
    return (
      <div className="bg-foreground px-6 py-2 text-center font-mono text-xs text-background">
        Local demo data. Nothing here is on Arkiv, ENS or Swarm.
      </div>
    )
  }
  if (health?.world === "dev") {
    return (
      <div className="border-b border-foreground/10 bg-foreground/[0.03] px-6 py-2 text-center font-mono text-xs text-muted-foreground">
        World ID is simulated in this build, so identities here are not verified humans.
      </div>
    )
  }
  return null
}

export function Shell({ children }: { children: ReactNode }) {
  const health = useHealth()
  const { member } = useMember()

  return (
    <div className="noise-overlay flex min-h-dvh flex-col bg-background text-foreground">
      <div className="page-lines" aria-hidden="true" />
      <header className="relative z-10 border-b border-foreground/10">
        <div className="mx-auto flex max-w-[1000px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-4">
          <Link href="/" className="font-display text-xl tracking-tight">
            Comment Desk
          </Link>
          <nav aria-label="Main" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <Link href="/dockets" className="transition-colors hover:text-foreground">
              Dockets
            </Link>
            <Link href="/dockets/new" className="transition-colors hover:text-foreground">
              Open a docket
            </Link>
            <Link href="/names" className="transition-colors hover:text-foreground">
              ENS names
            </Link>
            <Link href="/activity" className="transition-colors hover:text-foreground">
              On-chain activity
            </Link>
            {member && (
              <Link href="/agent" className="transition-colors hover:text-foreground">
                Your agent
              </Link>
            )}
            {member ? (
              <Link href="/join" className="max-w-[240px] truncate font-mono text-xs text-foreground">
                {member.ensName}
                {member.nameStatus === "creating" && <span className="text-muted-foreground"> · minting…</span>}
              </Link>
            ) : (
              <Link href="/join" className="text-foreground">
                Join
              </Link>
            )}
            <ThemeToggle className="h-7 w-7 border-0 hover:bg-foreground/5" />
          </nav>
        </div>
      </header>
      <div className="relative z-10">
        <Banner health={health} />
      </div>
      <main className="relative z-10 mx-auto w-full max-w-[1000px] flex-1 px-6 py-12">{children}</main>
      <footer className="relative z-10 border-t border-foreground/10">
        <div className="mx-auto flex max-w-[1000px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-5 font-mono text-xs text-muted-foreground">
          <span>Every voice is a real human. Every count is yours to check.</span>
          <BuiltWith />
          <Link href="/pitch" className="transition-colors hover:text-foreground">
            The pitch
          </Link>
        </div>
      </footer>
    </div>
  )
}
