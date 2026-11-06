/**
 * Creates the backend's wallets in .env and prints only their public addresses.
 * Keeps any key that already exists. .env is git-ignored.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const path = ".env";
if (!existsSync(path)) writeFileSync(path, readFileSync(".env.example", "utf8"));
let contents = readFileSync(path, "utf8");

const roles = [
  ["ARKIV_PRIVATE_KEY", "Arkiv publisher", "fund with test GLM at https://hub.arkiv.network/faucet"],
  ["ENS_OPERATOR_PRIVATE_KEY", "ENS operator", "fund with Sepolia ETH"],
  ["ENS_MODERATOR_PRIVATE_KEY", "ENS moderator", "fund with a little Sepolia ETH"],
] as const;

for (const [name, label, funding] of roles) {
  const line = new RegExp(`^${name}=(.*)$`, "m");
  const existing = contents.match(line)?.[1]?.trim();
  const key = (/^0x[0-9a-fA-F]{64}$/.test(existing ?? "") ? existing : generatePrivateKey()) as `0x${string}`;
  contents = line.test(contents) ? contents.replace(line, `${name}=${key}`) : `${contents.trimEnd()}\n${name}=${key}\n`;
  console.log(`${label}: ${privateKeyToAccount(key).address}  (${funding})`);
}
writeFileSync(path, contents);
