"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Eyebrow, Notice, Shell, useMember } from "@/components/app/shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { request, type CredentialLevel, type Member } from "@/lib/api"
import { signAction, textHash, typedData } from "@/lib/wallet"

function PolicyStep({ onSigned }: { onSigned: () => void }) {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function accept() {
    setBusy(true)
    setError("")
    try {
      const { policyVersion } = await typedData()
      const issuedAt = BigInt(Date.now())
      const signature = await signAction("AcceptDocketPolicy", { policyVersion, issuedAt })
      await request("/api/policies/docket-creation", { method: "POST", body: { issuedAt, signature } })
      onSigned()
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      <Notice>
        Opening a docket is a separate consent. You agree to run it in good faith and to publish a ruling after its
        deadline.
      </Notice>
      {error && <Notice tone="error">{error}</Notice>}
      <Button onClick={accept} disabled={busy} className="rounded-full">
        {busy ? "Recording your signature…" : "Sign the docket-creation policy"}
      </Button>
    </div>
  )
}

function DocketForm({ member }: { member: Member }) {
  const router = useRouter()
  const [label, setLabel] = useState("")
  const [title, setTitle] = useState("")
  const [question, setQuestion] = useState("")
  const [topicText, setTopicText] = useState("")
  const [deadline, setDeadline] = useState("")
  const [credentialLevel, setCredentialLevel] = useState<CredentialLevel>("proof_of_presence")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      const topics = topicText
        .split(",")
        .map((topic) => topic.trim().toLowerCase().replace(/\s+/g, "-"))
        .filter(Boolean)
      const deadlineAt = BigInt(new Date(deadline).getTime())
      const issuedAt = BigInt(Date.now())
      const signature = await signAction("OpenDocket", {
        label,
        title,
        bodyHash: textHash(JSON.stringify({ question, topics })),
        deadline: deadlineAt,
        credentialLevel,
        issuedAt,
      })
      const { key } = await request<{ key: string }>("/api/dockets", {
        method: "POST",
        body: { label, title, question, topics, deadline: deadlineAt, credentialLevel, issuedAt, signature },
      })
      router.push(`/dockets/${key}`)
    } catch (reason) {
      setError((reason as Error).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-6">
      <div className="space-y-2">
        <Label htmlFor="label">Docket name</Label>
        <Input id="label" value={label} onChange={(event) => setLabel(event.target.value.toLowerCase())} placeholder="truck-rule" required />
        <p className="break-all font-mono text-xs text-muted-foreground">
          {label || "docket"}.{member.ensName}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="question">The question</Label>
        <Textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} rows={4} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="topics">Topics, separated by commas</Label>
        <Input id="topics" value={topicText} onChange={(event) => setTopicText(event.target.value)} placeholder="emissions, cost" required />
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="deadline">Deadline</Label>
          <Input id="deadline" type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="credential">Credential required</Label>
          <select
            id="credential"
            value={credentialLevel}
            onChange={(event) => setCredentialLevel(event.target.value as CredentialLevel)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="proof_of_presence">Soft: Proof of Presence</option>
            <option value="proof_of_human">Strict: Proof of Human</option>
          </select>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" disabled={busy} className="rounded-full">
        {busy ? "Deploying its resolver. This takes about a minute…" : "Open this docket"}
      </Button>
    </form>
  )
}

export default function NewDocketPage() {
  const { member, refresh } = useMember()

  return (
    <Shell>
      <Eyebrow>New case</Eyebrow>
      <h1 className="mb-8 font-display text-5xl tracking-tight">Open a docket</h1>
      {member === undefined && <p className="text-sm text-muted-foreground">Checking your identity…</p>}
      {member === null && (
        <div className="max-w-lg space-y-4">
          <Notice>Only verified members can open a docket.</Notice>
          <Button asChild className="rounded-full">
            <Link href="/join">Join first</Link>
          </Button>
        </div>
      )}
      {member && !member.canOpenDockets && <PolicyStep onSigned={refresh} />}
      {member?.canOpenDockets && <DocketForm member={member} />}
    </Shell>
  )
}
