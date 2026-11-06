"use client"

import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { api, ensUrl, type Health, type Member } from "@/lib/api"
import { currentWallet } from "@/lib/wallet"

const MEMBER_CHANGED = "commentdesk:member-changed"

export function useMember() {
  const [member, setMember] = useState<Member | null>()
  useEffect(() => {
    const load = () => {
      const wallet = currentWallet()
      if (!wallet) return setMember(null)
      api.member(wallet.address).then(setMember).catch(() => setMember(null))
    }
    load()
    window.addEventListener(MEMBER_CHANGED, load)
    return () => window.removeEventListener(MEMBER_CHANGED, load)
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
      className={`break-all font-mono underline decoration-foreground/20 underline-offset-4 hover:decoration-foreground ${className}`}
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

export function Shell({ children }: { children: ReactNode }) {
  const health = useHealth()
  const { member } = useMember()

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-foreground/10">
        <div className="mx-auto flex max-w-[1000px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-4">
          <Link href="/" className="font-display text-xl tracking-tight">
            Comment Desk
          </Link>
          <nav className="flex items-center gap-5 text-sm text-muted-foreground">
            <Link href="/dockets" className="transition-colors hover:text-foreground">
              Dockets
            </Link>
            <Link href="/dockets/new" className="transition-colors hover:text-foreground">
              Open a docket
            </Link>
            {member ? (
              <Link href="/join" className="max-w-[220px] truncate font-mono text-xs text-foreground">
                {member.ensName}
              </Link>
            ) : (
              <Link href="/join" className="text-foreground">
                Join
              </Link>
            )}
          </nav>
        </div>
      </header>
      {health === null && (
        <div className="border-b border-destructive/30 px-6 py-2 text-center text-sm text-destructive">
          The Comment Desk API is not reachable, so this page cannot load.
        </div>
      )}
      {health?.mode === "memory" && (
        <div className="border-b border-foreground/20 bg-foreground px-6 py-2 text-center font-mono text-xs text-background">
          Local demo data. Nothing here is on Arkiv, ENS or Swarm.
        </div>
      )}
      <main className="mx-auto max-w-[1000px] px-6 py-12">{children}</main>
    </div>
  )
}
