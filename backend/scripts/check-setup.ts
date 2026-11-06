/**
 * Shows what is ready and what is missing. Read-only, and never prints a secret.
 *
 *   npm run check
 */
import { existsSync, readFileSync } from "node:fs";
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { createPublicClient as createViemClient, formatEther, http, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { SEPOLIA, ethRegistrarAbi } from "@commentdesk/contracts/ens";

const env: Record<string, string> = {};
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) env[match[1]!] = match[2]!.trim();
  }
}

let ready = true;
const row = (ok: boolean, label: string, detail: string) => {
  if (!ok) ready = false;
  console.log(`${ok ? "OK     " : "TO DO  "} ${label}: ${detail}`);
};
const addressOf = (name: string) =>
  /^0x[0-9a-fA-F]{64}$/.test(env[name] ?? "") ? privateKeyToAccount(env[name] as Hex).address : undefined;

const accessKey = env.ARKIV_ACCESS_KEY ?? "";
if (!accessKey) {
  row(false, "Arkiv access key", "add ARKIV_ACCESS_KEY to backend/.env");
} else {
  const keyed = createPublicClient({
    chain: rabdi({ accessKey }),
    transport: http(undefined, { timeout: 10_000, retryCount: 0 }),
  });
  const works = await keyed.getChainId().then((id) => id === 7794095).catch(() => false);
  row(works, "Arkiv access key", works ? "accepted by Rabdi" : "rejected: check it was copied in full");
}

const arkiv = createPublicClient({
  chain: rabdi({ accessKey }),
  transport: http(undefined, { timeout: 10_000, retryCount: 1 }),
});
const publisher = addressOf("ARKIV_PRIVATE_KEY");
if (publisher) {
  const balance = await arkiv.getBalance({ address: publisher }).catch(() => undefined);
  row(
    Boolean(balance),
    "Arkiv publisher",
    balance === undefined ? `could not read ${publisher}` : `${publisher} holds ${formatEther(balance)} test GLM`,
  );
} else {
  row(false, "Arkiv publisher", "run npm run setup:wallets");
}

const sepoliaClient = createViemClient({
  chain: sepolia,
  transport: http(env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com"),
});
for (const [name, label] of [
  ["ENS_OPERATOR_PRIVATE_KEY", "ENS operator"],
  ["ENS_MODERATOR_PRIVATE_KEY", "ENS moderator"],
] as const) {
  const address = addressOf(name);
  if (!address) {
    row(false, label, "run npm run setup:wallets");
    continue;
  }
  const balance = await sepoliaClient.getBalance({ address }).catch(() => undefined);
  row(
    Boolean(balance),
    label,
    balance === undefined ? `could not read ${address}` : `${address} holds ${formatEther(balance)} Sepolia ETH`,
  );
}

const rootLabel = env.ENS_ROOT_LABEL || "commentdesk";
const available = await sepoliaClient
  .readContract({ address: SEPOLIA.ethRegistrar, abi: ethRegistrarAbi as Abi, functionName: "isAvailable", args: [rootLabel] })
  .catch(() => undefined);
console.log(`INFO    ${rootLabel}.eth: ${available === undefined ? "could not check" : available ? "still free" : "already registered"}`);

console.log(ready ? "\nReady: run npm run setup:ens, then npm run smoke:arkiv" : "\nNot ready yet: finish the TO DO lines.");
process.exit(0);
