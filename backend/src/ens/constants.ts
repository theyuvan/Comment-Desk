import type { Address, Hex } from "viem";
import ethRegistrarAbiJson from "./abi/ETHRegistrar.json" with { type: "json" };
import ethRegistryAbiJson from "./abi/ETHRegistry.json" with { type: "json" };
import mockUsdcAbiJson from "./abi/MockUSDC.json" with { type: "json" };
import resolverAbiJson from "./abi/PermissionedResolverImpl.json" with { type: "json" };
import universalResolverAbiJson from "./abi/UniversalResolverV2.json" with { type: "json" };
import userRegistryAbiJson from "./abi/UserRegistryImpl.json" with { type: "json" };
import factoryAbiJson from "./abi/VerifiableFactory.json" with { type: "json" };

/**
 * Official ENSv2 deployment on Sepolia, from https://docs.ens.domains/learn/deployments.
 * ABIs in ./abi are the verified Sourcify ABIs of exactly these addresses. The
 * contracts-v2 main branch lags this deployment, so do not copy signatures from it.
 */
export const SEPOLIA = {
  ethRegistrar: "0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3",
  ethRegistry: "0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4",
  userRegistryImpl: "0x9bd8a88719068d09ecee662f36c0e3856708366a",
  permissionedResolverImpl: "0x115eb53f0c60696633855f90b138178fb40b2b2c",
  verifiableFactory: "0xda70306c98e97ece36f997a21368e53298572991",
  mockUsdc: "0x240b0316df57887dbbe58b586508b19e633a14aa",
  universalResolver: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
} as const satisfies Record<string, Address>;

export const ethRegistrarAbi = ethRegistrarAbiJson as never as typeof ethRegistrarAbiJson;
export const ethRegistryAbi = ethRegistryAbiJson as never as typeof ethRegistryAbiJson;
export const userRegistryAbi = userRegistryAbiJson as never as typeof userRegistryAbiJson;
export const resolverAbi = resolverAbiJson as never as typeof resolverAbiJson;
export const factoryAbi = factoryAbiJson as never as typeof factoryAbiJson;
export const mockUsdcAbi = mockUsdcAbiJson as never as typeof mockUsdcAbiJson;
export const universalResolverAbi = universalResolverAbiJson as never as typeof universalResolverAbiJson;

const admin = (role: bigint) => role << 128n;

/** Roles on a PermissionedRegistry / UserRegistry. */
export const REGISTRY_ROLES = {
  REGISTRAR: 1n << 0n,
  SET_PARENT: 1n << 8n,
  UNREGISTER: 1n << 12n,
  RENEW: 1n << 16n,
  SET_SUBREGISTRY: 1n << 20n,
  SET_RESOLVER: 1n << 24n,
  CAN_TRANSFER_ADMIN: (1n << 28n) << 128n,
} as const;

/** Roles on a PermissionedResolver, as deployed. These differ from contracts-v2 main. */
export const RESOLVER_ROLES = {
  SET_ADDRESS: 1n << 0n,
  SET_TEXT: 1n << 4n,
  SET_CONTENTHASH: 1n << 8n,
  SET_DATA: 1n << 24n,
  LINK: 1n << 28n,
} as const;

/** What the operator keeps on a registry it runs: enough to mint and route names. */
export const OPERATOR_REGISTRY_ROLES =
  REGISTRY_ROLES.REGISTRAR |
  admin(REGISTRY_ROLES.REGISTRAR) |
  REGISTRY_ROLES.RENEW |
  admin(REGISTRY_ROLES.RENEW) |
  REGISTRY_ROLES.SET_SUBREGISTRY |
  admin(REGISTRY_ROLES.SET_SUBREGISTRY) |
  REGISTRY_ROLES.SET_RESOLVER |
  admin(REGISTRY_ROLES.SET_RESOLVER) |
  REGISTRY_ROLES.SET_PARENT |
  admin(REGISTRY_ROLES.SET_PARENT);

/** What a member receives on the token for their own name. */
export const MEMBER_TOKEN_ROLES =
  REGISTRY_ROLES.SET_RESOLVER |
  admin(REGISTRY_ROLES.SET_RESOLVER) |
  REGISTRY_ROLES.SET_SUBREGISTRY |
  admin(REGISTRY_ROLES.SET_SUBREGISTRY) |
  REGISTRY_ROLES.RENEW |
  admin(REGISTRY_ROLES.RENEW);

/** Full control of a resolver's records, for its owner. */
export const RESOLVER_OWNER_ROLES =
  RESOLVER_ROLES.SET_ADDRESS |
  admin(RESOLVER_ROLES.SET_ADDRESS) |
  RESOLVER_ROLES.SET_TEXT |
  admin(RESOLVER_ROLES.SET_TEXT) |
  RESOLVER_ROLES.SET_CONTENTHASH |
  admin(RESOLVER_ROLES.SET_CONTENTHASH) |
  RESOLVER_ROLES.SET_DATA |
  admin(RESOLVER_ROLES.SET_DATA) |
  RESOLVER_ROLES.LINK |
  admin(RESOLVER_ROLES.LINK);

export const ADMIN_SET_TEXT = admin(RESOLVER_ROLES.SET_TEXT);

export const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;
export const COIN_TYPE_ETH = 60n;

/** Text record keys Comment Desk writes. */
export const TEXT_KEYS = {
  status: "status",
  title: "description",
  deadline: "commentdesk.deadline",
  topics: "commentdesk.topics",
  credential: "commentdesk.credential",
  arkivKey: "commentdesk.arkiv",
  author: "commentdesk.author",
  authorType: "commentdesk.author-type",
  topic: "commentdesk.topic",
  swarm: "commentdesk.swarm",
} as const;

/**
 * The only keys the operator may write on a docket resolver, so it can relay
 * signed requests for wallets that hold no gas. Everything else is the creator's.
 */
export const OPERATOR_DOCKET_KEYS = [
  TEXT_KEYS.status,
  TEXT_KEYS.arkivKey,
  TEXT_KEYS.author,
  TEXT_KEYS.authorType,
  TEXT_KEYS.topic,
  TEXT_KEYS.swarm,
] as const;
