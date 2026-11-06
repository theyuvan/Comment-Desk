"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { CredentialLabel, DocketPhase, formatDate } from "@/components/app/docket-phase"
import { EnsLink, Eyebrow, Notice, Shell, useMember } from "@/components/app/shell"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { api, request, type ArchiveCheck, type Comment, type Docket, type Member, type Tally } from "@/lib/api"
import { getWallet, signAction, textHash } from "@/lib/wallet"
import { getWorldProof } from "@/lib/world"

type AuthorType = "human" | "agent"
const SENTIMENTS = ["support", "oppose", "neutral"] as const

function TallyView({ tally }: { tally: Tally }) {
  const ignored = tally.ignored.duplicate + tally.ignored.late + tally.ignored.unknownTopic
  return (
    <section>
      <h2 className="mb-4 font-display text-2xl tracking-tight">Live tally</h2>
      <div className="space-y-5">
        {tally.topics.map((topic) => (
          <div key={topic.topic}>
            <div className="mb-1 flex justify-between text-sm">
              <span>{topic.topic}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {topic.counted} counted · {topic.human} human · {topic.agent} agent
              </span>
            </div>
            <div className="flex h-2 gap-px bg-foreground/5" aria-hidden="true">
              <div className="bg-foreground" style={{ flexGrow: topic.support }} />
              <div className="bg-foreground/50" style={{ flexGrow: topic.oppose }} />
              <div className="bg-foreground/20" style={{ flexGrow: topic.neutral }} />
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {topic.support} support · {topic.oppose} oppose · {topic.neutral} neutral
            </p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        {tally.counted} counted of {tally.stored} stored
        {ignored > 0 ? `, ${ignored} on record but not counted` : ""}.
      </p>
    </section>
  )
}

function Composer({ docket, member, onPosted }: { docket: Docket; member: Member; onPosted: () => void }) {
  const [authorType, setAuthorType] = useState<AuthorType>("human")
  const [topic, setTopic] = useState(docket.topics[0] ?? "")
  const [sentiment, setSentiment] = useState<(typeof SENTIMENTS)[number]>("support")
  const [stance, setStance] = useState("")
  const [approved, setApproved] = useState("")
  const [error, setError] = useState("")
  const [result, setResult] = useState("")
  const [busy, setBusy] = useState(false)

  const isAgent = authorType === "agent"
  const stale = isAgent && approved !== "" && approved !== stance

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    setResult("")
    try {
      const stanceHash = textHash(stance)
      const { submissionKey } = await request<{ submissionKey: `0x${string}` }>(
        `/api/dockets/${docket.key}/submission-key`,
        { method: "POST", body: { wallet: getWallet().address, topic, sentiment, stanceHash, authorType } },
      )
      const credentialLevel = docket.credentialLevel
      const worldProof = await getWorldProof(
        isAgent
          ? { action: "agent-confirm", draftKey: submissionKey, credentialLevel }
          : { action: "human-comment", signal: submissionKey, credentialLevel },
      )
      setApproved(stance)
      const issuedAt = BigInt(Date.now())
      const signature = await signAction("SubmitComment", {
        docket: docket.key,
        topic,
        sentiment,
        stanceHash,
        authorType,
        issuedAt,
      })
      const posted = await request<{ ensName: string; counted: boolean }>(`/api/dockets/${docket.key}/comments`, {
        method: "POST",
        body: { topic, sentiment, stance, authorType, issuedAt, signature, worldProof },
      })
      setResult(
        posted.counted
          ? `Posted and counted as ${posted.ensName}.`
          : `Posted as ${posted.ensName}. Only your first comment on a topic counts, so this one is on record but not in the tally.`,
      )
      setStance("")
      setApproved("")
      onPosted()
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2 className="mb-4 font-display text-2xl tracking-tight">Add your comment</h2>
      <div className="mb-5 grid grid-cols-2 border border-foreground/15 text-sm" role="tablist" aria-label="Who wrote this comment">
        {(["human", "agent"] as const).map((type) => (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={authorType === type}
            onClick={() => setAuthorType(type)}
            className={`px-4 py-3 text-left transition-colors ${
              authorType === type ? "bg-foreground text-background" : "hover:bg-foreground/5"
            }`}
          >
            <span className="block font-medium">{type === "human" ? "I wrote this" : "My agent drafted this"}</span>
            <span className={`block text-xs ${authorType === type ? "text-background/70" : "text-muted-foreground"}`}>
              {type === "human" ? "World ID check" : "Agent Pass confirm on the exact text"}
            </span>
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="topic">Topic</Label>
            <select
              id="topic"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {docket.topics.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sentiment">Your position</Label>
            <select
              id="sentiment"
              value={sentiment}
              onChange={(event) => setSentiment(event.target.value as (typeof SENTIMENTS)[number])}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm capitalize"
            >
              {SENTIMENTS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="stance">{isAgent ? "Your agent's draft" : "Your comment"}</Label>
          <Textarea id="stance" value={stance} onChange={(event) => setStance(event.target.value)} rows={5} required />
          {isAgent && (
            <p className="text-xs text-muted-foreground">
              Read every word. Your confirm covers this exact text, and any change needs a new confirm.
            </p>
          )}
        </div>
        {stale && <Notice>The draft changed after your last approval, so it needs a new confirm.</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        {result && <Notice>{result}</Notice>}
        <Button type="submit" disabled={busy || !stance.trim()} className="rounded-full">
          {busy ? "Verifying…" : isAgent ? "Confirm with Agent Pass and post" : "Verify with World ID and post"}
        </Button>
        <p className="font-mono text-xs text-muted-foreground">Posting as {isAgent ? `agent.${member.ensName}` : member.ensName}</p>
      </form>
    </section>
  )
}

function RulingForm({ docket, onClosed }: { docket: Docket; onClosed: () => void }) {
  const [ruling, setRuling] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      const issuedAt = BigInt(Date.now())
      const signature = await signAction("CloseDocket", { docket: docket.key, rulingHash: textHash(ruling), issuedAt })
      await request(`/api/dockets/${docket.key}/close`, { method: "POST", body: { ruling, issuedAt, signature } })
      onClosed()
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2 className="mb-4 font-display text-2xl tracking-tight">Publish the ruling</h2>
      <form onSubmit={submit} className="space-y-4">
        <Label htmlFor="ruling" className="sr-only">
          Ruling
        </Label>
        <Textarea id="ruling" value={ruling} onChange={(event) => setRuling(event.target.value)} rows={5} required />
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" disabled={busy || !ruling.trim()} className="rounded-full">
          {busy ? "Publishing…" : "Publish and close this docket"}
        </Button>
      </form>
    </section>
  )
}

function CaseRecord({ docket }: { docket: Docket }) {
  const [check, setCheck] = useState<ArchiveCheck>()
  const [error, setError] = useState("")

  useEffect(() => {
    if (docket.swarmRef) api.verifyArchive(docket.key).then(setCheck).catch((reason: Error) => setError(reason.message))
  }, [docket.key, docket.swarmRef])

  return (
    <section>
      <h2 className="mb-4 font-display text-2xl tracking-tight">Conclusion</h2>
      <blockquote className="border-l-2 border-foreground pl-4 text-lg leading-relaxed">{docket.ruling}</blockquote>
      <div className="mt-5 text-sm text-muted-foreground">
        {!docket.swarmRef && <p>Moving the full record to Swarm…</p>}
        {docket.swarmRef && (
          <p className="break-all font-mono text-xs">
            Permanent case file:{" "}
            {check ? (
              <a href={check.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                {docket.swarmRef}
              </a>
            ) : (
              docket.swarmRef
            )}
          </p>
        )}
        {check && (
          <p className="mt-2">
            {check.matches
              ? `Verified: the file on Swarm matches Arkiv, with ${check.commentsInFile} comments.`
              : "Warning: the file on Swarm does not match Arkiv."}
          </p>
        )}
        {error && <p className="mt-2 text-destructive">{error}</p>}
      </div>
    </section>
  )
}

export default function DocketPage() {
  const { key } = useParams<{ key: string }>()
  const { member } = useMember()
  const [docket, setDocket] = useState<Docket>()
  const [comments, setComments] = useState<Comment[]>([])
  const [tally, setTally] = useState<Tally>()
  const [error, setError] = useState("")

  const load = useCallback(() => {
    Promise.all([api.docket(key), api.comments(key), api.tally(key)])
      .then(([nextDocket, nextComments, nextTally]) => {
        setDocket(nextDocket)
        setComments(nextComments)
        setTally(nextTally)
      })
      .catch((reason: Error) => setError(reason.message))
  }, [key])

  useEffect(() => {
    load()
    const timer = setInterval(load, 8000)
    return () => clearInterval(timer)
  }, [load])

  if (!docket) {
    return (
      <Shell>
        {error ? <Notice tone="error">{error}</Notice> : <p className="text-sm text-muted-foreground">Reading from Arkiv…</p>}
      </Shell>
    )
  }

  const creatorName = docket.ensName.slice(docket.ensName.indexOf(".") + 1)
  const isCreator = member?.ensName === creatorName

  return (
    <Shell>
      <Eyebrow>
        <DocketPhase docket={docket} /> · <CredentialLabel docket={docket} />
      </Eyebrow>
      <h1 className="mb-3 font-display text-4xl tracking-tight sm:text-5xl">{docket.title}</h1>
      <p className="mb-2 text-sm text-muted-foreground">
        Opened by <EnsLink name={creatorName} /> as <EnsLink name={docket.ensName} />
      </p>
      <p className="mb-10 max-w-2xl text-lg leading-relaxed">{docket.question}</p>

      <div className="grid gap-12 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-12">
          {docket.ruling && <CaseRecord docket={docket} />}
          {docket.phase === "open" && member && <Composer docket={docket} member={member} onPosted={load} />}
          {docket.phase === "open" && member === null && (
            <Notice>
              <Link href="/join" className="underline underline-offset-4">
                Join
              </Link>{" "}
              to comment. One person, one counted voice per topic.
            </Notice>
          )}
          {docket.phase === "awaiting-ruling" && isCreator && <RulingForm docket={docket} onClosed={load} />}
          {docket.phase === "awaiting-ruling" && !isCreator && (
            <Notice>Comments are closed. This docket is waiting for its creator to publish a ruling.</Notice>
          )}

          <section>
            <h2 className="mb-4 font-display text-2xl tracking-tight">The record</h2>
            {comments.length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
            <ul className="divide-y divide-foreground/10 border-y border-foreground/10">
              {comments.map((comment) => (
                <li key={comment.key} className="py-4">
                  <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <EnsLink name={comment.authorEns} className="text-foreground" />
                    {comment.authorType === "agent" && <span className="border border-foreground/30 px-1.5 font-mono">agent drafted</span>}
                    {comment.proofRef.startsWith("dev:") && <span className="border border-destructive/40 px-1.5 font-mono text-destructive">unverified dev proof</span>}
                    <span className="font-mono">
                      {comment.topic} · {comment.sentiment}
                      {comment.ordinal > 1 ? " · not counted" : ""}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap leading-relaxed">{comment.stance}</p>
                  <p className="mt-2 font-mono text-xs text-muted-foreground">
                    {formatDate(comment.submittedAt)} · <EnsLink name={comment.ensName} />
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="space-y-6">
          {tally && <TallyView tally={tally} />}
          <Button asChild variant="outline" className="w-full rounded-full">
            <Link href={`/dockets/${docket.key}/recount`}>Recount this yourself</Link>
          </Button>
        </aside>
      </div>
    </Shell>
  )
}
