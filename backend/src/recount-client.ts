import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { and, asc, eq, gt } from "@arkiv-network/sdk/query";
import { key as keyValue } from "@arkiv-network/sdk/schema";
import { http, type Address, type Hex } from "viem";
import { CommentSchema, DocketSchema } from "@commentdesk/contracts/arkiv";
import { tally, type Tally, type TallyComment } from "./recount.ts";

export type Publisher = { address: Address; chainId: number };

/**
 * FR8: a recount that uses no Comment Desk server and no Comment Desk key. It
 * talks straight to Arkiv with the caller's own access key, or "" for the
 * public, rate-limited endpoint. It only trusts `$creator`, which cannot change
 * after an entity is created.
 */
export async function recountFromArkiv(input: {
  docketKey: Hex;
  publisher: Address;
  accessKey?: string;
}): Promise<{ title: string; status: string; tally: Tally; block: bigint }> {
  const client = createPublicClient({
    chain: rabdi({ accessKey: input.accessKey ?? "" }),
    cacheTime: 0,
    transport: http(undefined, { retryCount: 2, timeout: 15_000 }),
  });

  const docketPage = await client
    .select({ $key: true, deadline: true, title: true, status: true, body: true })
    .from(DocketSchema, { onMismatch: "throw" })
    .createdBy(input.publisher)
    .where(eq("$key", keyValue(input.docketKey)))
    .limit(1)
    .fetch();
  const docket = docketPage.entities[0];
  if (!docket) throw new Error("No docket with that key from that publisher");
  const body = JSON.parse(Buffer.from(docket.body.value.slice(2), "hex").toString("utf8")) as { topics: string[] };

  const comments: TallyComment[] = [];
  let last: Hex | undefined;
  let block = 0n;
  for (;;) {
    const filter = eq("docket_key", input.docketKey);
    const page = await client
      .select({
        $key: true,
        topic: true,
        owner_hash: true,
        author_type: true,
        sentiment: true,
        submitted_at: true,
      })
      .from(CommentSchema, { onMismatch: "throw" })
      .createdBy(input.publisher)
      .where(last ? and(filter, gt("$key", keyValue(last))) : filter)
      .orderBy(asc("$key"))
      .limit(100)
      .fetch();
    block = page.blockNumber;
    for (const row of page.entities) {
      comments.push({
        key: row.$key,
        topic: row.topic.value,
        ownerHash: row.owner_hash.value,
        authorType: row.author_type.value,
        sentiment: row.sentiment.value,
        submittedAt: row.submitted_at.value,
      });
    }
    if (page.entities.length < 100) break;
    last = page.entities.at(-1)?.$key;
  }

  return {
    title: docket.title.value,
    status: docket.status.value,
    tally: tally({ deadline: docket.deadline.value, topics: body.topics }, comments),
    block,
  };
}
