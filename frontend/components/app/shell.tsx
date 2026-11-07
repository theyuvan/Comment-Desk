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
      let found: Member | null = null
      let unreachable = false
      if (wallet) {
        // "Not a member" is an answer; a timeout or a 5xx is not, and must not read as "signed out".
        found = await api.member(wallet.address).catch(() => {
          unreachable = true
          return null
        })
      }
      if (found) {
        await ensureSession().catch(() => {})
      } else if (!wallet || unreachable) {
        // No unlocked passkey (a new tab, a restarted browser) or Arkiv is slow: the server session
        // (7 days) still knows who this is, so show them instead of "Join".
        const session = await request<{ memberRef: string; ensName: string } | null>("/api/session").catch(() => null)
        if (session) {
          found = {
            key: session.memberRef as Member["key"],
            ensName: session.ensName,
            joinedAt: "0",
            proofRef: "",
            canOpenDockets: false,
            isModerator: false,
            locked: !wallet,
          }
        }
      }
      if (!active) return
      // A failed lookup with nothing else to go on keeps whoever was shown, rather than flipping to "Join".
      setMember((previous) => found ?? (unreachable ? (previous ?? null) : null))
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

/** A quiet card for grouping content, so a page reads as sections instead of one dense wall of text. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-6 sm:p-8 ${className}`}>{children}</div>
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3 font-mono text-xs text-muted-foreground">
      <span className="h-px w-8 bg-foreground/30" />
      {children}
    </div>
  )
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

/** The same fade-up-on-mount the landing page uses for its hero and sections. */
function Reveal({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <div className={`transition-all duration-700 ${visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"}`}>
      {children}
    </div>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const health = useHealth()
  const { member } = useMember()

  return (
    <div className="noise-overlay flex min-h-dvh flex-col bg-background text-foreground">
      <div className="dot-grid" aria-hidden="true" />
      <header className="sticky top-0 z-20 border-b border-foreground/10 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1000px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-5">
          <Link href="/" className="font-display text-xl tracking-tight transition-opacity hover:opacity-70">
            Comment Desk
          </Link>
          <nav aria-label="Main" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <Link href="/dockets" className="group relative transition-colors hover:text-foreground">
              Dockets
              <span className="absolute -bottom-1 left-0 h-px w-0 bg-foreground transition-all duration-300 group-hover:w-full" />
            </Link>
            <Link href="/dockets/new" className="group relative transition-colors hover:text-foreground">
              Open a docket
              <span className="absolute -bottom-1 left-0 h-px w-0 bg-foreground transition-all duration-300 group-hover:w-full" />
            </Link>
            <Link href="/names" className="group relative transition-colors hover:text-foreground">
              ENS names
              <span className="absolute -bottom-1 left-0 h-px w-0 bg-foreground transition-all duration-300 group-hover:w-full" />
            </Link>
            <Link href="/activity" className="group relative transition-colors hover:text-foreground">
              On-chain activity
              <span className="absolute -bottom-1 left-0 h-px w-0 bg-foreground transition-all duration-300 group-hover:w-full" />
            </Link>
            {member && (
              <Link href="/agent" className="group relative transition-colors hover:text-foreground">
                Your agent
                <span className="absolute -bottom-1 left-0 h-px w-0 bg-foreground transition-all duration-300 group-hover:w-full" />
              </Link>
            )}
            {member ? (
              <Link
                href="/join"
                className="max-w-[240px] truncate rounded-full border border-foreground/15 px-3 py-1 font-mono text-xs text-foreground transition-colors hover:border-foreground"
              >
                {member.ensName}
                {member.nameStatus === "creating" && <span className="text-muted-foreground"> · minting…</span>}
              </Link>
            ) : (
              <Link
                href="/join"
                className="rounded-full bg-foreground px-4 py-1.5 text-background transition-colors hover:bg-foreground/90"
              >
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
      <main className="relative z-10 mx-auto w-full max-w-[1000px] flex-1 px-6 py-12 lg:py-16">
        <Reveal>{children}</Reveal>
      </main>
      <footer className="relative z-10 border-t border-foreground/10">
        <div className="mx-auto flex max-w-[1000px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-6 font-mono text-xs text-muted-foreground">
          <span>Every voice is a real human. Every count is yours to check.</span>
          <div className="flex items-center gap-5">
            <BuiltWith />
            <Link href="/pitch" className="transition-colors hover:text-foreground">
              The pitch
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
