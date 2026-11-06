import { createPublicClient } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { and, asc, eq, gt } from "@arkiv-network/sdk/query"
import { bytes, defineSchema, key as keyValue, str, u64 } from "@arkiv-network/sdk/schema"
import { hexToString, http, type Address, type Hex } from "viem"
import { tally, type Tally, type TallyComment } from "./recount"

// Only the columns a recount reads. Names must match backend/src/arkiv/schemas.ts.
const Docket = defineSchema("commentdesk_docket_v1", {
  deadline: u64().indexed(),
  status: str().indexed(),
  title: str(),
  body: bytes(),
})
const Comment = defineSchema("commentdesk_comment_v1", {
  docket_key: str().indexed(),
  topic: str().indexed(),
  owner_hash: str().indexed(),
  author_type: str().indexed(),
  sentiment: str().indexed(),
  submitted_at: u64().indexed(),
})

export type Recount = { title: string; status: string; tally: Tally; block: bigint }

/**
 * Runs in the visitor's browser and talks straight to Arkiv's public endpoint,
 * with no Comment Desk server or key involved. It trusts only `$creator`, which
 * cannot change after an entity is created.
 */
export async function recountInBrowser(docketKey: Hex, publisher: Address): Promise<Recount> {
  const client = createPublicClient({
    chain: rabdi({ accessKey: "" }),
    cacheTime: 0,
    transport: http(undefined, { retryCount: 3, timeout: 15_000 }),
  })

  const found = await client
    .select({ $key: true, deadline: true, title: true, status: true, body: true })
    .from(Docket, { onMismatch: "throw" })
    .createdBy(publisher)
    .where(eq("$key", keyValue(docketKey)))
    .limit(1)
    .fetch()
  const docket = found.entities[0]
  if (!docket) throw new Error("Arkiv has no docket with that key from that publisher.")
  const { topics } = JSON.parse(hexToString(docket.body.value)) as { topics: string[] }

  const comments: TallyComment[] = []
  let last: Hex | undefined
  let block = BigInt(0)
  for (;;) {
    const onDocket = eq("docket_key", docketKey)
    const page = await client
      .select({ $key: true, topic: true, owner_hash: true, author_type: true, sentiment: true, submitted_at: true })
      .from(Comment, { onMismatch: "throw" })
      .createdBy(publisher)
      .where(last ? and(onDocket, gt("$key", keyValue(last))) : onDocket)
      .orderBy(asc("$key"))
      .limit(100)
      .fetch()
    block = page.blockNumber
    for (const row of page.entities) {
      comments.push({
        key: row.$key,
        topic: row.topic.value,
        ownerHash: row.owner_hash.value,
        authorType: row.author_type.value,
        sentiment: row.sentiment.value,
        submittedAt: row.submitted_at.value,
      })
    }
    if (page.entities.length < 100) break
    last = page.entities.at(-1)?.$key
  }

  return {
    title: docket.title.value,
    status: docket.status.value,
    tally: tally({ deadline: docket.deadline.value, topics }, comments),
    block,
  }
}
