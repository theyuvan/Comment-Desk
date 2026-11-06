/**
 * Recounts a docket straight from Arkiv. Needs no Comment Desk server or key.
 *
 *   npx tsx scripts/recount.ts <docketKey> <publisherAddress>
 *
 * Set ARKIV_ACCESS_KEY to your own key to avoid the public rate limit.
 */
import type { Address, Hex } from "viem";
import { recountFromArkiv } from "../src/recount-client.ts";

const [docketKey, publisher] = process.argv.slice(2);
if (!docketKey || !publisher) {
  console.error("Usage: npx tsx scripts/recount.ts <docketKey> <publisherAddress>");
  process.exit(1);
}

const result = await recountFromArkiv({
  docketKey: docketKey as Hex,
  publisher: publisher as Address,
  accessKey: process.env.ARKIV_ACCESS_KEY ?? "",
});
console.log(`${result.title} [${result.status}] at Arkiv block ${result.block}`);
console.table(result.tally.topics);
console.log(`Counted ${result.tally.counted} of ${result.tally.stored} stored.`, result.tally.ignored);
