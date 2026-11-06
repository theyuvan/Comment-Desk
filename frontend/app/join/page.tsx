"use client"

import { useEffect, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { EnsLink, Eyebrow, Loading, Notice, Shell, Steps, useHealth, useMember } from "@/components/app/shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, request } from "@/lib/api"
import { createWallet, currentWallet, signAction, signOut, typedData, unlockWallet, walletKind } from "@/lib/wallet"
import { WorldVerifyButton } from "@/world/WorldVerifyButton"

const STEPS = ["Choose your name", "Create your passkey", "Verify with World ID"]

/** A same-site path to return to, so joining from a docket brings you back to it. */
function nextPath() {
  const next = new URLSearchParams(window.location.search).get("next")
  return next?.startsWith("/") && !next.startsWith("//") ? next : null
}

function JoinFlow({ onJoined, onReturning }: { onJoined: () => void; onReturning: () => void }) {
  const health = useHealth()
  const [handle, setHandle] = useState("")
  const [wallet, setWallet] = useState<string>()
  const [active, setActive] = useState(0)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [returning, setReturning] = useState<string>()
  const rootName = health?.rootName ?? "commentdesk.eth"

  async function prepare(event: FormEvent) {
    event.preventDefault()
    setError("")
    setBusy(true)
    setActive(1)
    try {
      await createWallet(`${handle}.${rootName}`)
      const { policyVersion } = await typedData()
      const issuedAt = BigInt(Date.now())
      const signature = await signAction("Join", { handle, policyVersion, issuedAt })
      await request("/api/policies/join", { method: "POST", body: { handle, issuedAt, signature } })
      setWallet(currentWallet()?.address)
      setActive(2)
    } catch (reason) {
      setError((reason as Error).message)
      setActive(0)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <Steps steps={STEPS} active={active} />
      {active < 2 ? (
        <form onSubmit={prepare} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="handle">Choose your name</Label>
            <Input
              id="handle"
              value={handle}
              onChange={(event) => setHandle(event.target.value.toLowerCase())}
              placeholder="maya"
              autoComplete="off"
              required
            />
            <p className="font-mono text-xs text-muted-foreground">
              {handle || "yourname"}.{rootName}
            </p>
          </div>
          <Notice>
            Your passkey is your wallet: Face ID, a fingerprint or Windows Hello, with no seed phrase and nothing to
            fund. Your name stays yours and can never be sold or transferred. Continuing signs the Comment Desk policy:
            one identity per person, and your comments are public.
          </Notice>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" disabled={busy || !handle} className="rounded-full">
            {busy ? "Waiting for your passkey…" : "Create passkey"}
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Last step. World ID proves <span className="text-foreground">{handle}.{rootName}</span> belongs to one unique
            human, without revealing who you are. It can take about a minute to mint your name.
          </p>
          {returning ? (
            <Notice>
              Welcome back. This World ID already holds <span className="font-mono">{returning}</span>, so no second name
              was made. Sign in below with the passkey you created it with.
            </Notice>
          ) : (
            <WorldVerifyButton<{ ensName: string; returning: boolean }>
              input={{ purpose: "join", handle, wallet }}
              verifyPath="/api/world/verify/join"
              label="Verify with World ID and join"
              onVerified={(result) => {
                if (!result.returning) return onJoined()
                // One human, one name: the passkey made just now owns nothing, so drop it.
                signOut()
                setReturning(result.ensName)
                onReturning()
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function signIn() {
    setBusy(true)
    setError("")
    try {
      const wallet = await unlockWallet()
      if (!(await api.member(wallet.address))) {
        signOut()
        throw new Error("That passkey has no Comment Desk identity yet. Join above.")
      }
      onSignedIn()
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-10 max-w-xl space-y-3 border-t border-foreground/10 pt-6">
      <p className="text-sm text-muted-foreground">Already a member? Your passkey brings your identity to this device.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <Button variant="outline" onClick={signIn} disabled={busy} className="rounded-full">
        {busy ? "Waiting for your passkey…" : "Sign in with passkey"}
      </Button>
    </div>
  )
}

export default function JoinPage() {
  const router = useRouter()
  const { member, refresh } = useMember()
  const [address, setAddress] = useState<string>()
  // Re-renders the page once a returning human's new passkey is dropped, so sign-in shows.
  const [, setDropped] = useState(0)

  useEffect(() => {
    if (member) setAddress(currentWallet()?.address)
  }, [member])

  const finished = () => {
    refresh()
    const next = nextPath()
    if (next) router.push(next)
  }

  async function leave() {
    await request("/api/session/logout", { method: "POST", body: {} }).catch(() => {})
    signOut()
    refresh()
  }

  return (
    <Shell>
      <Eyebrow>Identity</Eyebrow>
      <h1 className="mb-8 font-display text-5xl tracking-tight">{member ? "Your identity" : "One human, one voice"}</h1>
      {member === undefined && <Loading>Checking this browser…</Loading>}
      {member && (
        <div className="max-w-xl space-y-5">
          <p className="text-lg">
            <EnsLink name={member.ensName} />
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {walletKind() === "passkey"
              ? "Secured by your passkey. No key is stored on this device."
              : "This device has no passkey support, so your key is kept in this browser. Clearing site data loses this identity."}
          </p>
          {member.proofRef.startsWith("dev:") && (
            <Notice>This identity used the development stand-in for World ID. It is not a verified human.</Notice>
          )}
          <dl className="border-y border-foreground/10 py-3 font-mono text-xs text-muted-foreground">
            <dt className="inline">Wallet </dt>
            <dd className="inline break-all">{address}</dd>
          </dl>
          <div className="flex flex-wrap gap-3">
            <Button asChild className="rounded-full">
              <Link href="/dockets">Browse dockets</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/dockets/new">Open a docket</Link>
            </Button>
            {walletKind() === "passkey" && (
              <Button variant="ghost" className="rounded-full" onClick={leave}>
                Sign out
              </Button>
            )}
          </div>
        </div>
      )}
      {member === null && (
        <>
          <JoinFlow onJoined={finished} onReturning={() => setDropped((count) => count + 1)} />
          {!currentWallet() && <SignIn onSignedIn={finished} />}
        </>
      )}
    </Shell>
  )
}
