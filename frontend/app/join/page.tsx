"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { keccak256 } from "viem"
import { EnsLink, Eyebrow, Notice, Shell, useHealth, useMember } from "@/components/app/shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, request } from "@/lib/api"
import { createWallet, currentWallet, signAction, signOut, typedData, unlockWallet, walletKind } from "@/lib/wallet"
import { getWorldProof } from "@/lib/world"

function JoinForm({ onJoined }: { onJoined: () => void }) {
  const health = useHealth()
  const [handle, setHandle] = useState("")
  const [error, setError] = useState("")
  const [step, setStep] = useState("")
  const rootName = health?.rootName ?? "commentdesk.eth"

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError("")
    try {
      setStep("Creating your passkey…")
      await createWallet(`${handle}.${rootName}`)
      setStep("Verifying and minting your name…")
      const { policyVersion } = await typedData()
      const issuedAt = BigInt(Date.now())
      const signature = await signAction("Join", { handle, policyVersion, issuedAt })
      const worldProof = await getWorldProof({ action: "join", signal: keccak256(signature) })
      await request("/api/members", { method: "POST", body: { handle, issuedAt, signature, worldProof } })
      onJoined()
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setStep("")
    }
  }

  return (
    <form onSubmit={submit} className="max-w-lg space-y-6">
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
        Your passkey is your wallet. Use Face ID, a fingerprint or Windows Hello: there is no seed phrase, nothing to
        fund, and no key saved anywhere. Your name stays with you and can never be sold or transferred. Joining signs
        the Comment Desk policy: one identity per person, and your comments are public.
      </Notice>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" disabled={Boolean(step) || !handle} className="rounded-full">
        {step || "Create passkey and join"}
      </Button>
    </form>
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
    <div className="mt-10 max-w-lg space-y-3 border-t border-foreground/10 pt-6">
      <p className="text-sm text-muted-foreground">Already a member? Your passkey brings your identity to this device.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <Button variant="outline" onClick={signIn} disabled={busy} className="rounded-full">
        {busy ? "Waiting for your passkey…" : "Sign in with passkey"}
      </Button>
    </div>
  )
}

export default function JoinPage() {
  const { member, refresh } = useMember()

  return (
    <Shell>
      <Eyebrow>Identity</Eyebrow>
      <h1 className="mb-8 font-display text-5xl tracking-tight">{member ? "Your identity" : "One human, one voice"}</h1>
      {member === undefined ? (
        <p className="text-sm text-muted-foreground">Checking this browser…</p>
      ) : member ? (
        <div className="max-w-lg space-y-4">
          <p className="text-lg">
            <EnsLink name={member.ensName} />
          </p>
          <p className="text-sm text-muted-foreground">
            {walletKind() === "passkey"
              ? "Secured by your passkey. No key is stored on this device."
              : "This device has no passkey support, so your key is kept in this browser. Clearing site data loses this identity."}
          </p>
          {member.proofRef.startsWith("dev:") && (
            <Notice>This identity used the development stand-in for World ID. It is not a verified human.</Notice>
          )}
          <div className="flex flex-wrap gap-3">
            <Button asChild className="rounded-full">
              <Link href="/dockets">Browse dockets</Link>
            </Button>
            {walletKind() === "passkey" && (
              <Button
                variant="outline"
                className="rounded-full"
                onClick={() => {
                  signOut()
                  refresh()
                }}
              >
                Sign out
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          <JoinForm onJoined={refresh} />
          {!currentWallet() && <SignIn onSignedIn={refresh} />}
        </>
      )}
    </Shell>
  )
}
