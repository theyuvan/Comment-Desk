"use client"

import { Suspense, useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Eyebrow, Loading, Notice, Panel, Shell, useHealth } from "@/components/app/shell"
import { api, ensUrl, explorer, type NameKind, type NameNode } from "@/lib/api"

const ROOT = "commentdesk.eth"

/** What each kind of name is, and what ENSv2 makes it do. */
const PURPOSE: Record<NameKind, { title: string; body: string; points: string[] }> = {
  root: {
    title: "The platform root",
    body: "Every verified member gets exactly one name under it. Each member then gets their own subname registry, so their dockets live under their name, not ours.",
    points: [
      "Member registries are emancipated from birth: the operator can register and renew, never change or delete a name",
      "One World ID join nullifier per human, so one name per human",
    ],
  },
  member: {
    title: "One verified human",
    body: "Owned by the member's passkey wallet and resolves to it. Created after a World ID Proof of Human, and it can't be sold or handed on.",
    points: [
      "Non-transferable: ROLE_CAN_TRANSFER_ADMIN is withheld when the name is registered",
      "Their own Permissioned Resolver, where they hold every role and the operator holds none",
      "Their own registry, so their dockets and their agent sit under this name",
    ],
  },
  agent: {
    title: "The member's AI agent",
    body: "A separate name for the agent, under the member's own. Every comment the agent drafted, and the member approved with World ID Agent Pass, is authored by this name, so human and agent authorship are two names anyone can resolve.",
    points: ["Owned by the member, with no roles at all: it can't be moved or changed", "Resolves to the member's wallet: the human who stands behind it"],
  },
  docket: {
    title: "A consultation",
    body: "Its own Permissioned Resolver holds the rules the World ID gate reads live before any comment is accepted: status, credential, deadline and topics. Change the ENS record and the gate changes with it.",
    points: [
      "Enhanced Access Control, split by record: the creator sets the docket's facts, the operator sets comment and archive records, a moderator can set only status",
      "Nobody holds text admin: it's revoked in the deployment, so those rights can never be widened",
      "Its own registry, so every comment is a real name under it",
    ],
  },
  comment: {
    title: "One comment",
    body: "Owned by its author, with no roles, so it can't be transferred, edited or deleted. Its records say who wrote it, whether an agent drafted it, which topic it's on and where its full text lives on Arkiv.",
    points: ["The text itself is a read-only Arkiv entity, linked below", "Counted once per human per topic, enforced by World ID"],
  },
}

const RECORD_LABEL: Record<string, string> = {
  description: "Title / about",
  status: "Status",
  "commentdesk.deadline": "Deadline",
  "commentdesk.topics": "Topics",
  "commentdesk.credential": "World ID credential",
  "commentdesk.agents": "Agents",
  "commentdesk.arkiv": "Arkiv record",
  "commentdesk.author": "Author",
  "commentdesk.author-type": "Written by",
  "commentdesk.topic": "Topic",
  "commentdesk.swarm": "Swarm case file",
}

const KIND_LABEL: Record<NameKind, string> = { root: "root", member: "member", agent: "agent", docket: "docket", comment: "comment" }

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="break-all underline underline-offset-4 hover:text-foreground">
      {children} ↗
    </a>
  )
}

const NameLink = ({ name }: { name: string }) => (
  <Link href={`/names?name=${encodeURIComponent(name)}`} className="break-all underline underline-offset-4 hover:text-foreground">
    {name}
  </Link>
)

function RecordValue({ name, keyName, value }: { name: string; keyName: string; value: string }) {
  if (keyName === "commentdesk.arkiv") return <External href={explorer.arkivEntity(value)}>{value}</External>
  if (keyName === "commentdesk.swarm") return <External href={explorer.swarm(value)}>{value}</External>
  if (keyName === "commentdesk.author") return <NameLink name={value} />
  if (keyName === "commentdesk.deadline") return <>{new Date(value).toLocaleString()}</>
  return <span className="break-all">{value || <span className="text-muted-foreground">(empty for {name})</span>}</span>
}

function Breadcrumb({ name }: { name: string }) {
  const labels = name.split(".")
  const rootDepth = ROOT.split(".").length
  const chain = labels.slice(0, labels.length - rootDepth + 1).map((_, index) => labels.slice(index).join(".")).reverse()
  return (
    <nav aria-label="Name chain" className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted-foreground">
      {chain.map((item, index) => (
        <span key={item} className="flex items-center gap-x-2">
          {index > 0 && <span aria-hidden="true">›</span>}
          {item === name ? <span className="text-foreground">{item}</span> : <NameLink name={item} />}
        </span>
      ))}
    </nav>
  )
}

function NameView({ node }: { node: NameNode }) {
  const purpose = PURPOSE[node.kind]
  const records = Object.entries(node.records)
  const groups = (["agent", "docket", "member", "comment"] as NameKind[])
    .map((kind) => ({ kind, items: node.children.filter((child) => child.kind === kind) }))
    .filter((group) => group.items.length > 0)

  return (
    <>
      <Breadcrumb name={node.name} />
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="break-all font-display text-3xl tracking-tight sm:text-4xl">{node.name}</h1>
        <span className="rounded-full border border-foreground/30 px-2.5 py-0.5 font-mono text-xs">{KIND_LABEL[node.kind]}</span>
      </div>
      <p className="mb-10 font-mono text-xs text-muted-foreground">
        <External href={ensUrl(node.name)}>Open in the ENS app</External>
      </p>

      {node.nameStatus === "creating" && (
        <div className="mb-6">
          <Notice>This name is still being created on ENS. The records below fill in as its transactions land.</Notice>
        </div>
      )}

      <div className="grid gap-12 lg:grid-cols-[1fr_320px] lg:gap-16">
        <div className="min-w-0 space-y-14">
          <section>
            <h2 className="mb-4 font-display text-2xl tracking-tight">{purpose.title}</h2>
            <Panel className="p-6 sm:p-7">
              <p className="leading-relaxed">{purpose.body}</p>
              <ul className="mt-4 space-y-2 border-t border-foreground/10 pt-4 text-sm text-muted-foreground">
                {purpose.points.map((point) => (
                  <li key={point} className="flex gap-2">
                    <span className="text-foreground/40">·</span>
                    {point}
                  </li>
                ))}
              </ul>
            </Panel>
          </section>

          <section>
            <h2 className="mb-1 font-display text-2xl tracking-tight">Live ENS records</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Read just now from Sepolia through the ENS Universal Resolver, exactly as any wallet or app would see them.
            </p>
            {records.length === 0 ? (
              <p className="text-sm text-muted-foreground">No text records on this name.</p>
            ) : (
              <dl className="divide-y divide-foreground/10 overflow-hidden rounded-2xl border border-foreground/10 bg-foreground/[0.02] text-sm">
                {records.map(([key, value]) => (
                  <div key={key} className="grid gap-1 px-6 py-4 sm:grid-cols-[180px_1fr] sm:gap-4">
                    <dt className="text-muted-foreground">
                      {RECORD_LABEL[key] ?? key}
                      <span className="block font-mono text-[10px]">{key}</span>
                    </dt>
                    <dd>
                      <RecordValue name={node.name} keyName={key} value={value} />
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          {groups.map((group) => (
            <section key={group.kind}>
              <h2 className="mb-4 font-display text-2xl tracking-tight">
                {group.kind === "member" ? "Members" : group.kind === "docket" ? "Dockets" : group.kind === "comment" ? "Comments" : "Agent"}
                <span className="ml-2 font-mono text-sm text-muted-foreground">{group.items.length}</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((child) => (
                  <Link
                    key={child.name}
                    href={`/names?name=${encodeURIComponent(child.name)}`}
                    className="group rounded-xl border border-foreground/10 bg-foreground/[0.02] px-4 py-3 text-sm transition-colors hover:border-foreground/30 hover:bg-foreground/[0.04]"
                  >
                    <span className="block break-all font-medium text-foreground underline-offset-4 group-hover:underline">{child.name}</span>
                    {child.detail && <span className="mt-0.5 block text-xs text-muted-foreground">{child.detail}</span>}
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Panel className="p-6">
            <dl className="space-y-5 font-mono text-xs">
              <div>
                <dt className="mb-1 text-muted-foreground">Resolves to</dt>
                <dd className="break-all">{node.address ? <External href={explorer.sepoliaAddress(node.address)}>{node.address}</External> : "no address"}</dd>
              </div>
              <div>
                <dt className="mb-1 text-muted-foreground">Resolver contract</dt>
                <dd className="break-all">{node.resolver ? <External href={explorer.sepoliaAddress(node.resolver)}>{node.resolver}</External> : "none"}</dd>
              </div>
              {node.arkivKey && (
                <div>
                  <dt className="mb-1 text-muted-foreground">Arkiv entity</dt>
                  <dd className="break-all">
                    <External href={explorer.arkivEntity(node.arkivKey)}>{node.arkivKey}</External>
                  </dd>
                </div>
              )}
              <div className="border-t border-foreground/10 pt-5">
                <dt className="mb-1 text-muted-foreground">Every transaction behind it</dt>
                <dd>
                  <Link href={`/activity?subject=${encodeURIComponent(node.name)}`} className="underline underline-offset-4 hover:text-foreground">
                    On-chain activity
                  </Link>
                </dd>
              </div>
            </dl>
          </Panel>
        </aside>
      </div>
    </>
  )
}

function Names() {
  const name = (useSearchParams().get("name") ?? ROOT).toLowerCase()
  const health = useHealth()
  const [node, setNode] = useState<NameNode>()
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    setNode(undefined)
    setError("")
    api
      .name(name)
      .then((found) => active && setNode(found))
      .catch((reason: Error) => active && setError(reason.message))
    return () => {
      active = false
    }
  }, [name])

  return (
    <>
      <Eyebrow>ENSv2 on Sepolia{health?.mode === "memory" ? " · memory mode, names are not on-chain" : ""}</Eyebrow>
      {error && <Notice tone="error">{error}</Notice>}
      {!node && !error && <Loading>Reading {name} from Sepolia…</Loading>}
      {node && <NameView node={node} />}
    </>
  )
}

export default function NamesPage() {
  return (
    <Shell>
      <Suspense fallback={<Loading>Reading names from Sepolia…</Loading>}>
        <Names />
      </Suspense>
    </Shell>
  )
}
