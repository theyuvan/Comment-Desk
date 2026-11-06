"use client"

import { useEffect, useState, type FormEvent } from "react"
import Link from "next/link"
import { keccak256 } from "viem"
import { EnsLink, Eyebrow, Notice, Shell, useHealth, useMember } from "@/components/app/shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { request } from "@/lib/api"
import { signAction, typedData } from "@/lib/wallet"
import { getWorldProof } from "@/lib/world"

function JoinForm({ onJoined }: { onJoined: () => void }) {
  const health = useHealth()
  const [handle, setHandle] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      const { policyVersion } = await typedData()
      const issuedAt = BigInt(Date.now())
      const signature = await signAction("Join", { handle, policyVersion, issuedAt })
      const worldProof = await getWorldProof({ action: "join", signal: keccak256(signature) })
      await request("/api/members", { method: "POST", body: { handle, issuedAt, signature, worldProof } })
      onJoined()
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
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
          {handle || "yourname"}.{health?.rootName ?? "commentdesk.eth"}
        </p>
      </div>
      <Notice>
        Joining signs the Comment Desk join policy: one identity per person, and your comments are public. Your wallet
        is created in this browser and never holds funds.
      </Notice>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" disabled={busy || !handle} className="rounded-full">
        {busy ? "Verifying and minting your name…" : "Verify with World ID and join"}
      </Button>
    </form>
  )
}

export default function JoinPage() {
  const { member, refresh } = useMember()
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])

  return (
    <Shell>
      <Eyebrow>Identity</Eyebrow>
      <h1 className="mb-8 font-display text-5xl tracking-tight">{member ? "Your identity" : "One human, one voice"}</h1>
      {!ready || member === undefined ? (
        <p className="text-sm text-muted-foreground">Checking this browser…</p>
      ) : member ? (
        <div className="max-w-lg space-y-4">
          <p className="text-lg">
            <EnsLink name={member.ensName} />
          </p>
          {member.proofRef.startsWith("dev:") && (
            <Notice>This identity used the development stand-in for World ID. It is not a verified human.</Notice>
          )}
          <Button asChild className="rounded-full">
            <Link href="/dockets">Browse dockets</Link>
          </Button>
        </div>
      ) : (
        <JoinForm onJoined={refresh} />
      )}
    </Shell>
  )
}
