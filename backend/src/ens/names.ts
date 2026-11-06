import {
  encodeAbiParameters,
  keccak256,
  namehash,
  stringToHex,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { normalize, packetToBytes } from "viem/ens";

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/

/** Labels with a fixed meaning under a member's name. */
const RESERVED = new Set(["agent", "admin", "root", "www", "commentdesk"]);

export function normalizeLabel(raw: string): string {
  const label = normalize(raw.trim());
  if (!LABEL.test(label) || label.includes("--")) {
    throw new Error("Use 2 to 40 lowercase letters, digits or single hyphens");
  }
  return label;
}

export function assertUsableLabel(label: string): void {
  if (RESERVED.has(label)) throw new Error(`"${label}" is reserved`);
}

export function dnsEncode(name: string): Hex {
  return toHex(packetToBytes(name));
}

export function labelhash(label: string): bigint {
  return BigInt(keccak256(stringToHex(label)));
}

/** keccak256("UserRegistry", namehash, version), the salt scheme ENSv2 documents. */
export function registrySalt(name: string, version = 0n): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }],
        [keccak256(stringToHex("UserRegistry")), namehash(name), version],
      ),
    ),
  );
}

/**
 * ENSv2 defaults to one resolver per owner. A docket needs its own instance, so
 * the docket's name goes into the salt alongside the owner.
 */
export function docketResolverSalt(owner: Address, docketName: string, version = 0n): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "uint256" }],
        [keccak256(stringToHex("CommentDeskDocketResolver")), owner, namehash(docketName), version],
      ),
    ),
  );
}

/** keccak256("OwnedResolver", owner, version): ENS's per-account resolver scheme. */
export function ownedResolverSalt(owner: Address, version = 0n): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
        [keccak256(stringToHex("OwnedResolver")), owner, version],
      ),
    ),
  );
}
