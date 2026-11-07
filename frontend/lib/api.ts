import type { Address, Hex } from "viem"

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ""
/** A Sepolia ENS app page for any name, so the name chain is clickable. */
export const ensUrl = (name: string) => `https://sepolia.app.ens.domains/${name}`

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export type Health = {
  ok: boolean
  mode: "live" | "memory"
  world: "dev" | "world"
  rootName: string
  publisher: Address
  chainId: number
}
export type DocketRules = { ensName: string; status: string; credential: string; agents: string }
export type Stats = { members: number; dockets: number; comments: number; countedComments: number }
export type Member = {
  key: Hex
  ensName: string
  joinedAt: string
  proofRef: string
  /** "creating" while the member's ENS name is still being minted. */
  nameStatus?: "creating" | "failed" | "ready"
  canOpenDockets: boolean
  isModerator: boolean
  /**
   * Known from the server session only: the passkey isn't unlocked in this tab, so nothing can be
   * signed yet. Commenting still works (World ID is the check); opening a docket or a ruling needs an unlock.
   */
  locked?: boolean
}

export type ReceiptStep = {
  label: string
  chain: "world" | "arkiv" | "sepolia" | "swarm"
  status: "done" | "failed"
  at: number
  tx?: string
  entityKey?: string
  ref?: string
}

/** One action and everything it recorded, with something checkable for each step. */
export type Receipt = {
  id: string
  kind: "policy" | "join" | "docket" | "comment" | "ruling" | "moderation"
  subject: string
  status: "running" | "done" | "failed"
  startedAt: number
  finishedAt?: number
  expected: string[]
  steps: ReceiptStep[]
  error?: string
}

export type NameKind = "root" | "member" | "agent" | "docket" | "comment"

/** One ENS name under the root, read live from Sepolia, with the names directly under it. */
export type NameNode = {
  name: string
  kind: NameKind
  parent: string | null
  address: Address | null
  resolver: Address | null
  records: Record<string, string>
  arkivKey: string | null
  nameStatus?: "creating" | "failed" | "ready"
  children: { name: string; kind: NameKind; detail?: string }[]
}

/** Public explorers for each kind of record. */
export const explorer = {
  sepoliaTx: (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`,
  sepoliaAddress: (address: string) => `https://sepolia.etherscan.io/address/${address}`,
  arkivEntity: (key: string) => `https://rabdi.explorer.arkiv.network/entity/${key}`,
  swarm: (ref: string) => `https://api.gateway.ethswarm.org/bzz/${ref}/`,
}
export type CredentialLevel = "strict" | "soft"
export type Phase = "open" | "awaiting-ruling" | "closed" | "closed-for-cause"

export type Docket = {
  key: Hex
  ensName: string
  status: "open" | "closed" | "closed-for-cause"
  phase: Phase
  credentialLevel: CredentialLevel
  deadline: string
  createdAt: string
  title: string
  question: string
  topics: string[]
  ruling?: string
  closedAt?: string
  swarmRef?: string
}

export type Comment = {
  key: Hex
  docketKey: string
  topic: string
  authorType: "human" | "agent"
  sentiment: "support" | "oppose" | "neutral"
  submittedAt: string
  ensName: string
  authorEns: string
  proofRef: string
  ordinal: number
  stance: string
}

export type TopicTally = {
  topic: string
  counted: number
  stored: number
  support: number
  oppose: number
  neutral: number
  human: number
  agent: number
}

export type Tally = {
  counted: number
  stored: number
  ignored: { duplicate: number; late: number; unknownTopic: number }
  topics: TopicTally[]
}

export type ArchiveCheck = {
  swarmRef: string
  url: string
  commentsInFile: number
  commentsOnArkiv: number
  matches: boolean
}

export async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body:
        init?.body === undefined
          ? undefined
          : JSON.stringify(init.body, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
    })
  } catch {
    throw new ApiError("offline", "The Comment Desk API is not reachable.")
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(body.error ?? "failed", body.message ?? "That request failed.")
  return body as T
}

export const api = {
  health: () => request<Health>("/api/health"),
  stats: () => request<Stats>("/api/stats"),
  dockets: () => request<Docket[]>("/api/dockets"),
  docket: (key: string) => request<Docket>(`/api/dockets/${key}`),
  comments: (key: string) => request<Comment[]>(`/api/dockets/${key}/comments`),
  tally: (key: string) => request<Tally>(`/api/dockets/${key}/tally`),
  rules: (key: string) => request<DocketRules>(`/api/dockets/${key}/rules`),
  verifyArchive: (key: string) => request<ArchiveCheck>(`/api/dockets/${key}/archive/verify`),
  name: (name: string) => request<NameNode>(`/api/names/${encodeURIComponent(name)}`),
  activity: (filter: { subject?: string; limit?: number } = {}) => {
    const query = new URLSearchParams()
    if (filter.subject) query.set("subject", filter.subject)
    if (filter.limit) query.set("limit", String(filter.limit))
    return request<Receipt[]>(`/api/activity?${query}`)
  },
  member: async (wallet: Address) => {
    try {
      return await request<Member>(`/api/members/by-wallet/${wallet}`)
    } catch (error) {
      if (error instanceof ApiError && error.code === "not_a_member") return null
      throw error
    }
  },
}
