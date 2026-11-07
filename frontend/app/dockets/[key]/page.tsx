"use client"

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Countdown } from "@/components/app/countdown"
import { CredentialLabel, DocketPhase, formatDate } from "@/components/app/docket-phase"
import { EnsLink, Eyebrow, Loading, Notice, Panel, Shell, useMember } from "@/components/app/shell"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api, request, type ArchiveCheck, type Comment, type Docket, type Member, type Tally } from "@/lib/api"
import { signAction, textHash } from "@/lib/wallet"
import { AgentDraftReview } from "@/world/AgentDraftReview"
import { AgentInterview } from "@/world/AgentInterview"
import { AgentPassResult } from "@/world/AgentPassResult"
import { WorldVerifyButton } from "@/world/WorldVerifyButton"
import { ReceiptPanel, ReceiptView, useReceipt } from "@/components/app/receipt"

/** The live record of a comment just posted: Arkiv first, then its ENS name. */
function CommentReceipt({ name }: { name: string }) {
  const receipt = useReceipt(name, { kind: "comment", waiting: true })
  return receipt ? <ReceiptPanel title={`How ${name} was recorded`} receipt={receipt} /> : null
}

/** How the docket itself was recorded, if this server opened it. */
function DocketReceipt({ name }: { name: string }) {
  const receipt = useReceipt(name, { kind: "docket" })
  if (!receipt) return null
  return (
    <details className="border border-foreground/15 p-4 text-sm">
      <summary className="cursor-pointer">How this docket was recorded</summary>
      <div className="mt-3">
        <ReceiptView receipt={receipt} />
      </div>
    </details>
  )
}

const SENTIMENTS = ["support", "oppose", "neutral"] as const

function TallyView({ tally }: { tally: Tally }) {
  const ignored = tally.ignored.duplicate + tally.ignored.late + tally.ignored.unknownTopic
  return (
    <section>
      <h2 className="mb-4 font-display text-2xl tracking-tight">Live tally</h2>
      <Panel className="p-5 sm:p-6">
        <div className="space-y-6">
          {tally.topics.map((topic) => (
            <div key={topic.topic}>
              <div className="mb-2 flex justify-between gap-3 text-sm">
                <span className="font-medium">{topic.topic}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {topic.human} human · {topic.agent} agent
                </span>
              </div>
              <div className="flex h-2 gap-px overflow-hidden rounded-full bg-foreground/5" aria-hidden="true">
                <div className="bg-foreground" style={{ flexGrow: topic.support }} />
                <div className="bg-foreground/50" style={{ flexGrow: topic.oppose }} />
                <div className="bg-foreground/20" style={{ flexGrow: topic.neutral }} />
              </div>
              <p className="mt-1.5 font-mono text-xs text-muted-foreground">
                {topic.support} support · {topic.oppose} oppose · {topic.neutral} neutral
              </p>
            </div>
          ))}
        </div>
        <p className="mt-6 border-t border-foreground/10 pt-4 text-sm text-muted-foreground">
          {tally.counted} counted of {tally.stored} stored
          {ignored > 0 ? `, ${ignored} on record but not counted` : ""}.
        </p>
      </Panel>
    </section>
  )
}

function Composer({ docket, comments, member, onPosted }: { docket: Docket; comments: Comment[]; member: Member; onPosted: () => void }) {
  const [path, setPath] = useState<"human" | "agent">("human")
  const [topic, setTopic] = useState("")
  const [sentiment, setSentiment] = useState<(typeof SENTIMENTS)[number]>("support")
  const [text, setText] = useState("")
  const [posted, setPosted] = useState("")
  const [postedName, setPostedName] = useState("")
  const [drafted, setDrafted] = useState(0)
  const naming = member.nameStatus === "creating"

  const done = new Set(
    comments.filter((comment) => comment.authorEns === member.ensName || comment.authorEns === `agent.${member.ensName}`).map((comment) => comment.topic),
  )
  const open = docket.topics.filter((item) => !done.has(item))
  const selected = open.includes(topic) ? topic : (open[0] ?? "")

  if (open.length === 0) {
    return <Notice>You&apos;ve commented on every topic. One counted voice per human per topic.</Notice>
  }

  return (
    <section>
      <h2 className="mb-4 font-display text-2xl tracking-tight">Add your comment</h2>
      {naming && (
        <div className="mb-5">
          <Notice>
            Your name {member.ensName} is still being created on ENS. Comments are signed by that name, so you can post
            in a moment. This page updates by itself.
          </Notice>
        </div>
      )}
      <Panel className="p-5 sm:p-7">
        <div className="mb-6 grid grid-cols-2 gap-2 rounded-xl border border-foreground/15 p-1 text-sm" role="tablist" aria-label="Who wrote this comment">
          {(["human", "agent"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={path === item}
              onClick={() => setPath(item)}
              className={`rounded-lg px-4 py-3 text-left transition-colors ${path === item ? "bg-foreground text-background" : "hover:bg-foreground/5"}`}
            >
              <span className="block font-medium">{item === "human" ? "I wrote this" : "My agent drafted this"}</span>
              <span className={`block text-xs ${path === item ? "text-background/70" : "text-muted-foreground"}`}>
                {item === "human" ? "World ID check when you post" : "World ID Agent Pass on the exact text"}
              </span>
            </button>
          ))}
        </div>

        {path === "human" ? (
          <div className="space-y-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="field">
                <Label htmlFor="topic">Topic</Label>
                <Select value={selected} onValueChange={setTopic}>
                  <SelectTrigger id="topic" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {open.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="field">
                <Label htmlFor="sentiment">Your position</Label>
                <Select value={sentiment} onValueChange={(value) => setSentiment(value as (typeof SENTIMENTS)[number])}>
                  <SelectTrigger id="sentiment" className="w-full capitalize">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SENTIMENTS.map((item) => (
                      <SelectItem key={item} value={item} className="capitalize">
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="stance">Your comment</Label>
              <Textarea
                id="stance"
                value={text}
                onChange={(event) => {
                  setText(event.target.value)
                  setPosted("")
                }}
                rows={5}
                placeholder="Write it in your own words."
              />
            </div>
            {posted && <p className="ok">{posted}</p>}
            {postedName && <CommentReceipt name={postedName} />}
            <WorldVerifyButton<{ ensName: string }>
              input={{ purpose: "comment", docketKey: docket.key, topic: selected, text, sentiment }}
              verifyPath="/api/world/verify/comment"
              label="Verify with World ID and post"
              disabled={!text.trim() || naming}
              onVerified={(comment) => {
                setPosted(`Posted as ${comment.ensName}. Its name will appear on ENS in a moment.`)
                setPostedName(comment.ensName)
                setText("")
                onPosted()
              }}
            />
          </div>
        ) : (
          <div className="space-y-8">
            <AgentInterview docketKey={docket.key} onDraft={() => setDrafted((count) => count + 1)} />
            <AgentDraftReview docketKey={docket.key} refresh={drafted} />
          </div>
        )}
      </Panel>
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
      <h2 className="mb-2 font-display text-2xl tracking-tight">Publish the ruling</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        This concludes the case. The ruling and the full record then move to Swarm as the permanent case file.
      </p>
      <Panel className="p-5 sm:p-7">
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
      </Panel>
    </section>
  )
}

function Moderation({ docket, onClosed }: { docket: Docket; onClosed: () => void }) {
  const [reason, setReason] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      const issuedAt = BigInt(Date.now())
      const signature = await signAction("ModerateDocket", { docket: docket.key, reason, issuedAt })
      await request(`/api/dockets/${docket.key}/moderate`, { method: "POST", body: { reason, issuedAt, signature } })
      onClosed()
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="border border-foreground/15 p-4 text-sm">
      <summary className="cursor-pointer">Moderator: close for cause</summary>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          Your ENS role can change only this docket&apos;s status. The reason is published as its conclusion.
        </p>
        <Label htmlFor="reason" className="sr-only">
          Reason
        </Label>
        <Textarea id="reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="Why this docket is being closed" required />
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" variant="outline" disabled={busy || !reason.trim()} className="rounded-full">
          {busy ? "Closing…" : "Close this docket"}
        </Button>
      </form>
    </details>
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
      <Panel className="p-6 sm:p-8">
        <blockquote className="border-l-2 border-foreground pl-5 text-lg leading-relaxed">{docket.ruling}</blockquote>
        <div className="mt-6 space-y-2 border-t border-foreground/10 pt-5 text-sm text-muted-foreground">
          {!docket.swarmRef && <Loading>Moving the full record to Swarm…</Loading>}
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
            <p>
              {check.matches
                ? `Verified: the file on Swarm matches Arkiv, with ${check.commentsInFile} comments.`
                : "Warning: the file on Swarm does not match Arkiv."}
            </p>
          )}
          {error && <p className="text-destructive">{error}</p>}
        </div>
      </Panel>
    </section>
  )
}

function CommentItem({ comment }: { comment: Comment }) {
  return (
    <li className="px-6 py-6">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <EnsLink name={comment.authorEns} className="font-medium text-foreground" />
        <span className="font-mono text-xs text-muted-foreground">{formatDate(comment.submittedAt)}</span>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="rounded-full border border-foreground/15 px-2 py-0.5 font-mono capitalize">
          {comment.topic} · {comment.sentiment}
        </span>
        {comment.ordinal > 1 && <span className="rounded-full border border-foreground/15 px-2 py-0.5 font-mono">not counted</span>}
        {comment.authorType === "agent" && (
          <span className="rounded-full border border-foreground/30 px-2 py-0.5 font-mono">agent drafted · human approved</span>
        )}
        {comment.proofRef.startsWith("dev:") && (
          <span className="rounded-full border border-destructive/40 px-2 py-0.5 font-mono text-destructive">unverified dev proof</span>
        )}
      </div>
      <p className="whitespace-pre-wrap leading-relaxed">{comment.stance}</p>
      <details className="mt-3 font-mono text-xs text-muted-foreground">
        <summary className="cursor-pointer transition-colors hover:text-foreground">check this record</summary>
        <dl className="mt-3 space-y-2 border-t border-foreground/10 pt-3">
          <div>
            <dt className="inline">ENS </dt>
            <dd className="inline">
              <EnsLink name={comment.ensName} />
            </dd>
          </div>
          <div>
            <dt className="inline">Arkiv </dt>
            <dd className="inline break-all">
              <a href={`https://rabdi.explorer.arkiv.network/entity/${comment.key}`} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                {comment.key}
              </a>
            </dd>
          </div>
          <div className="break-all">
            <dt className="inline">Proof </dt>
            <dd className="inline">{comment.proofRef}</dd>
          </div>
          <div>
            <dt className="inline">Receipt </dt>
            <dd className="inline">
              <Link href={`/activity?subject=${encodeURIComponent(comment.ensName)}`} className="underline underline-offset-4">
                every transaction behind this comment
              </Link>
            </dd>
          </div>
        </dl>
      </details>
    </li>
  )
}

export default function DocketPage() {
  const { key } = useParams<{ key: string }>()
  const { member } = useMember()
  const [docket, setDocket] = useState<Docket>()
  const [comments, setComments] = useState<Comment[]>([])
  const [tally, setTally] = useState<Tally>()
  const [filter, setFilter] = useState("all")
  const [error, setError] = useState("")

  const load = useCallback(() => {
    Promise.all([api.docket(key), api.comments(key), api.tally(key)])
      .then(([nextDocket, nextComments, nextTally]) => {
        setDocket(nextDocket)
        setComments(nextComments)
        setTally(nextTally)
        setError("")
      })
      .catch((reason: Error) => setError(reason.message))
  }, [key])

  useEffect(() => {
    load()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [load])

  if (!docket) {
    return <Shell>{error ? <Notice tone="error">{error}</Notice> : <Loading>Reading from Arkiv…</Loading>}</Shell>
  }

  const creatorName = docket.ensName.slice(docket.ensName.indexOf(".") + 1)
  const isCreator = member?.ensName === creatorName
  const visible = comments.filter((comment) => filter === "all" || comment.topic === filter)
  const moderatable = member?.isModerator && (docket.phase === "open" || docket.phase === "awaiting-ruling")

  return (
    <Shell>
      <Suspense>
        <AgentPassResult />
      </Suspense>
      <Eyebrow>
        <DocketPhase docket={docket} />
        {docket.phase === "open" && (
          <>
            {" · "}
            <Countdown to={docket.deadline} onEnd={load} />
          </>
        )}
        {" · "}
        <CredentialLabel docket={docket} />
      </Eyebrow>
      <h1 className="mb-4 font-display text-4xl tracking-tight sm:text-5xl">{docket.title}</h1>
      <nav aria-label="Name chain" className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <EnsLink name={creatorName} />
        <span aria-hidden="true">›</span>
        <EnsLink name={docket.ensName} />
        <Link href={`/names?name=${encodeURIComponent(docket.ensName)}`} className="ml-2 underline underline-offset-4 hover:text-foreground">
          See its ENS records and every comment name
        </Link>
      </nav>
      <p className="mb-12 max-w-2xl text-lg leading-relaxed text-muted-foreground">{docket.question}</p>

      <div className="grid gap-12 lg:grid-cols-[1fr_340px] lg:gap-16">
        <div className="min-w-0 space-y-14">
          {docket.ruling && <CaseRecord docket={docket} />}
          {docket.phase === "open" && member && <Composer docket={docket} comments={comments} member={member} onPosted={load} />}
          {docket.phase === "open" && member === null && (
            <Notice>
              <Link href={`/join?next=/dockets/${docket.key}`} className="underline underline-offset-4">
                Join or sign in
              </Link>{" "}
              to comment. One person, one counted voice per topic.
            </Notice>
          )}
          {docket.phase === "awaiting-ruling" && isCreator && <RulingForm docket={docket} onClosed={load} />}
          {docket.phase === "awaiting-ruling" && !isCreator && (
            <Notice>Comments are closed. This docket is waiting for its creator to publish a ruling.</Notice>
          )}

          <section>
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="font-display text-2xl tracking-tight">The record</h2>
              {docket.topics.length > 1 && comments.length > 0 && (
                <Select value={filter} onValueChange={setFilter}>
                  <SelectTrigger aria-label="Filter comments by topic" size="sm" className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All topics</SelectItem>
                    {docket.topics.map((topic) => (
                      <SelectItem key={topic} value={topic}>
                        {topic}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {visible.length === 0 && (
              <p className="text-sm text-muted-foreground">{comments.length === 0 ? "No comments yet." : "No comments on this topic."}</p>
            )}
            <ul className="divide-y divide-foreground/10 overflow-hidden rounded-2xl border border-foreground/10 empty:hidden">
              {visible.map((comment) => (
                <CommentItem key={comment.key} comment={comment} />
              ))}
            </ul>
          </section>
        </div>

        <aside className="space-y-8">
          {tally && <TallyView tally={tally} />}
          <Button asChild variant="outline" size="lg" className="w-full rounded-full">
            <Link href={`/dockets/${docket.key}/recount`}>Recount this yourself</Link>
          </Button>
          <DocketReceipt name={docket.ensName} />
          {moderatable && <Moderation docket={docket} onClosed={load} />}
        </aside>
      </div>
    </Shell>
  )
}
