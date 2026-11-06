/**
 * Read-only check that the store's queries are valid on live Rabdi. Needs no key
 * or funds. Set ARKIV_ACCESS_KEY to avoid the public rate limit.
 *
 *   npx tsx scripts/probe-arkiv.ts
 */
import { recountFromArkiv } from "../src/recount-client.ts";

const missingDocket = `0x${"11".repeat(32)}` as const;
const publisher = "0x1000000000000000000000000000000000000001";

try {
  await recountFromArkiv({ docketKey: missingDocket, publisher, accessKey: process.env.ARKIV_ACCESS_KEY ?? "" });
  console.log("Unexpected: found a docket");
} catch (error) {
  const message = (error as Error).message.split("\n")[0];
  console.log(
    message === "No docket with that key from that publisher"
      ? "PASS Rabdi accepted the query and correctly found no docket"
      : `FAIL ${(error as Error).name}: ${message}`,
  );
}
process.exit(0);
