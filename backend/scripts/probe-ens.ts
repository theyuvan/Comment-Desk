/**
 * Prints what ENS says about a docket and a comment, read through the Universal
 * Resolver with viem, exactly as any other app would. Read-only.
 *
 *   npx tsx scripts/probe-ens.ts <docketName>
 */
import { createPublicClient, http, type Abi, type Address } from "viem";
import { sepolia } from "viem/chains";
import { SEPOLIA, TEXT_KEYS, universalHelperAbi } from "@commentdesk/contracts/ens";
import { dnsEncode } from "../src/ens/names.ts";

const docketName = process.argv[2];
if (!docketName) {
  console.error("Usage: npx tsx scripts/probe-ens.ts <docketName>");
  process.exit(1);
}
const commentName = `comment-1.${docketName}`;
const client = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com", { retryCount: 4 }),
});
const text = (name: string, key: string) =>
  client.getEnsText({ name, key, universalResolverAddress: SEPOLIA.universalResolver }).catch((error: Error) => `ERROR ${error.name}`);

console.log(`docket status:      ${await text(docketName, TEXT_KEYS.status)}`);
console.log(`docket title:       ${await text(docketName, TEXT_KEYS.title)}`);
console.log(`docket swarm:       ${await text(docketName, TEXT_KEYS.swarm)}`);
console.log(`comment author:     ${await text(commentName, TEXT_KEYS.author)}`);
console.log(`comment author type:${await text(commentName, TEXT_KEYS.authorType)}`);
console.log(`comment topic:      ${await text(commentName, TEXT_KEYS.topic)}`);
console.log(`comment arkiv key:  ${await text(commentName, TEXT_KEYS.arkivKey)}`);
const owner = (await client.readContract({
  address: SEPOLIA.universalHelper,
  abi: universalHelperAbi as Abi,
  functionName: "findExactOwner",
  args: [dnsEncode(commentName)],
})) as Address;
console.log(`comment owner:      ${owner}`);
process.exit(0);
