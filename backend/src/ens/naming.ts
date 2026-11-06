import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type PrivateKeyAccount,
} from "viem";
import { sepolia } from "viem/chains";
import { AppError, SerialQueue } from "../core.ts";
import {
  ADMIN_SET_TEXT,
  COIN_TYPE_ETH,
  MEMBER_TOKEN_ROLES,
  OPERATOR_DOCKET_KEYS,
  OPERATOR_REGISTRY_ROLES,
  RESOLVER_OWNER_ROLES,
  SEPOLIA,
  TEXT_KEYS,
  factoryAbi,
  resolverAbi,
  userRegistryAbi,
} from "./constants.ts";
import { dnsEncode, docketResolverSalt, labelhash, platformResolverSalt, registrySalt } from "./names.ts";

export type DocketRecords = {
  title: string;
  deadline: bigint;
  topics: string[];
  credentialLevel: string;
};

/** Services depend on this, so they can be tested without a network. */
export interface Naming {
  readonly rootName: string;
  registerMember(label: string, wallet: Address): Promise<string>;
  openDocket(input: { memberName: string; label: string; wallet: Address; records: DocketRecords }): Promise<string>;
  linkDocket(docketName: string, arkivKey: Hex): Promise<void>;
  writeComment(input: {
    docketName: string;
    commentName: string;
    authorEns: string;
    authorType: string;
    topic: string;
    arkivKey: Hex;
  }): Promise<void>;
  ensureAgentName(memberName: string, wallet: Address): Promise<string>;
  setDocketStatus(docketName: string, status: string, by: "operator" | "moderator"): Promise<void>;
  setDocketArchive(docketName: string, swarmRef: string): Promise<void>;
}

const ONE_YEAR = 31_536_000n;
const parentOf = (name: string) => name.slice(name.indexOf(".") + 1);
const labelOf = (name: string) => name.slice(0, name.indexOf("."));
const setText = (name: string, key: string, value: string) =>
  encodeFunctionData({ abi: resolverAbi as Abi, functionName: "setText", args: [dnsEncode(name), key, value] });
const setAddress = (name: string, wallet: Address) =>
  encodeFunctionData({ abi: resolverAbi as Abi, functionName: "setAddress", args: [dnsEncode(name), COIN_TYPE_ETH, wallet] });
const textSetter = (key: string) =>
  encodeFunctionData({ abi: resolverAbi as Abi, functionName: "setText", args: ["0x", key, ""] });

/**
 * Every call sequence here is exercised against real Sepolia state by
 * scripts/simulate-ens.ts. Change them together.
 *
 *   commentdesk.eth          UserRegistry, shared platform resolver
 *   maya.commentdesk.eth     token owned by the member, UserRegistry on first docket
 *   rule.maya.commentdesk... token owned by the member, its own PermissionedResolver
 *   comment-1.rule.maya...   records on that resolver, served by wildcard, no token
 */
export class EnsNaming implements Naming {
  readonly rootName: string;
  readonly client;
  private readonly wallet;
  private readonly queue = new SerialQueue();

  constructor(
    private readonly options: {
      rpcUrl: string;
      rootName: string;
      operator: PrivateKeyAccount;
      moderator?: PrivateKeyAccount;
      moderators: Address[];
    },
  ) {
    this.rootName = options.rootName;
    const transport = http(options.rpcUrl);
    this.client = createPublicClient({ chain: sepolia, transport });
    this.wallet = createWalletClient({ chain: sepolia, transport });
  }

  private get operator() {
    return this.options.operator;
  }

  private predict(salt: bigint) {
    return this.client.readContract({
      address: SEPOLIA.verifiableFactory,
      abi: factoryAbi as Abi,
      functionName: "predictProxyAddress",
      args: [this.operator.address, salt],
    }) as Promise<Address>;
  }

  private registryOf(name: string) {
    return this.predict(registrySalt(name));
  }

  private platformResolver() {
    return this.predict(platformResolverSalt(this.operator.address));
  }

  private async isDeployed(address: Address) {
    return Boolean(await this.client.getCode({ address }));
  }

  private async send(
    address: Address,
    abi: unknown,
    functionName: string,
    args: unknown[],
    account: PrivateKeyAccount = this.operator,
  ): Promise<Hex> {
    let request;
    try {
      ({ request } = await this.client.simulateContract({ account, address, abi: abi as Abi, functionName, args }));
    } catch {
      throw new AppError(502, "ens_rejected", `ENS rejected ${functionName}. Nothing was sent.`);
    }
    const hash = await this.wallet.writeContract(request);
    const receipt = await this.client.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") {
      throw new AppError(502, "ens_reverted", `ENS ${functionName} reverted: ${hash}`);
    }
    return hash;
  }

  private ownerOf(registry: Address, label: string) {
    return this.client.readContract({
      address: registry,
      abi: userRegistryAbi as Abi,
      functionName: "findOwner",
      args: [label],
    }) as Promise<Address>;
  }

  private expiry() {
    return BigInt(Math.floor(Date.now() / 1000)) + ONE_YEAR;
  }

  /** Safe to call twice: a name already held by this wallet counts as done. */
  registerMember(label: string, wallet: Address): Promise<string> {
    return this.queue.run(async () => {
      const name = `${label}.${this.rootName}`;
      const registry = await this.registryOf(this.rootName);
      const resolver = await this.platformResolver();
      const owner = await this.ownerOf(registry, label);
      if (owner !== zeroAddress && owner.toLowerCase() !== wallet.toLowerCase()) {
        throw new AppError(409, "handle_taken", `${name} is already taken.`);
      }
      if (owner === zeroAddress) {
        await this.send(registry, userRegistryAbi, "register", [
          label, wallet, zeroAddress, resolver, MEMBER_TOKEN_ROLES, this.expiry(),
        ]);
        await this.send(resolver, resolverAbi, "multicall", [[setAddress(name, wallet)]]);
      }
      return name;
    });
  }

  private async ensureMemberRegistry(memberName: string): Promise<Address> {
    const registry = await this.registryOf(memberName);
    if (!(await this.isDeployed(registry))) {
      const init = encodeFunctionData({
        abi: userRegistryAbi as Abi,
        functionName: "initialize",
        args: [[{ account: this.operator.address, roleBitmap: OPERATOR_REGISTRY_ROLES }]],
      });
      await this.send(SEPOLIA.verifiableFactory, factoryAbi, "deployProxy", [
        SEPOLIA.userRegistryImpl, registrySalt(memberName), init,
      ]);
    }
    const root = await this.registryOf(this.rootName);
    const attached = (await this.client.readContract({
      address: root,
      abi: userRegistryAbi as Abi,
      functionName: "getSubregistry",
      args: [labelOf(memberName)],
    })) as Address;
    if (attached.toLowerCase() !== registry.toLowerCase()) {
      await this.send(root, userRegistryAbi, "setSubregistry", [labelhash(labelOf(memberName)), registry]);
    }
    return registry;
  }

  openDocket(input: { memberName: string; label: string; wallet: Address; records: DocketRecords }): Promise<string> {
    return this.queue.run(async () => {
      const { memberName, label, wallet, records } = input;
      const name = `${label}.${memberName}`;
      const registry = await this.ensureMemberRegistry(memberName);
      if ((await this.ownerOf(registry, label)) !== zeroAddress) {
        throw new AppError(409, "docket_taken", `${name} already exists.`);
      }

      // The creator owns every record. The operator holds text admin only for this deploy.
      const salt = docketResolverSalt(wallet, name);
      const resolver = await this.predict(salt);
      const init = encodeFunctionData({
        abi: resolverAbi as Abi,
        functionName: "initialize",
        args: [
          [
            { account: wallet, roleBitmap: RESOLVER_OWNER_ROLES },
            { account: this.operator.address, roleBitmap: ADMIN_SET_TEXT },
          ],
          [
            setText(name, TEXT_KEYS.status, "open"),
            setText(name, TEXT_KEYS.title, records.title),
            setText(name, TEXT_KEYS.deadline, new Date(Number(records.deadline)).toISOString()),
            setText(name, TEXT_KEYS.topics, records.topics.join(",")),
            setText(name, TEXT_KEYS.credential, records.credentialLevel),
          ],
        ],
      });
      await this.send(SEPOLIA.verifiableFactory, factoryAbi, "deployProxy", [
        SEPOLIA.permissionedResolverImpl, salt, init,
      ]);

      // Enhanced Access Control: scope the operator and moderators to single keys,
      // then give up the admin role so neither can ever reach the creator's records.
      const moderators = [...new Set(this.moderatorAddresses())];
      await this.send(resolver, resolverAbi, "multicall", [
        [
          ...OPERATOR_DOCKET_KEYS.map((key) =>
            encodeFunctionData({
              abi: resolverAbi as Abi,
              functionName: "grantSetterRoles",
              args: [textSetter(key), this.operator.address],
            }),
          ),
          ...moderators.map((moderator) =>
            encodeFunctionData({
              abi: resolverAbi as Abi,
              functionName: "grantSetterRoles",
              args: [textSetter(TEXT_KEYS.status), moderator],
            }),
          ),
          encodeFunctionData({
            abi: resolverAbi as Abi,
            functionName: "revokeRootRoles",
            args: [ADMIN_SET_TEXT, this.operator.address],
          }),
        ],
      ]);

      await this.send(registry, userRegistryAbi, "register", [
        label, wallet, zeroAddress, resolver, MEMBER_TOKEN_ROLES, this.expiry(),
      ]);
      return name;
    });
  }

  private moderatorAddresses(): Address[] {
    const { moderator, moderators } = this.options;
    return [...moderators, ...(moderator ? [moderator.address.toLowerCase() as Address] : [])];
  }

  private async docketResolver(docketName: string): Promise<Address> {
    const registry = await this.registryOf(parentOf(docketName));
    return (await this.client.readContract({
      address: registry,
      abi: userRegistryAbi as Abi,
      functionName: "getResolver",
      args: [labelOf(docketName)],
    })) as Address;
  }

  linkDocket(docketName: string, arkivKey: Hex): Promise<void> {
    return this.queue.run(async () => {
      const resolver = await this.docketResolver(docketName);
      await this.send(resolver, resolverAbi, "setText", [dnsEncode(docketName), TEXT_KEYS.arkivKey, arkivKey]);
    });
  }

  writeComment(input: {
    docketName: string;
    commentName: string;
    authorEns: string;
    authorType: string;
    topic: string;
    arkivKey: Hex;
  }): Promise<void> {
    return this.queue.run(async () => {
      const resolver = await this.docketResolver(input.docketName);
      await this.send(resolver, resolverAbi, "multicall", [
        [
          setText(input.commentName, TEXT_KEYS.arkivKey, input.arkivKey),
          setText(input.commentName, TEXT_KEYS.author, input.authorEns),
          setText(input.commentName, TEXT_KEYS.authorType, input.authorType),
          setText(input.commentName, TEXT_KEYS.topic, input.topic),
        ],
      ]);
    });
  }

  /** agent.maya.commentdesk.eth: human and agent authorship as two resolvable names. */
  ensureAgentName(memberName: string, wallet: Address): Promise<string> {
    return this.queue.run(async () => {
      const name = `agent.${memberName}`;
      const registry = await this.ensureMemberRegistry(memberName);
      if ((await this.ownerOf(registry, "agent")) === zeroAddress) {
        const resolver = await this.platformResolver();
        await this.send(registry, userRegistryAbi, "register", [
          "agent", wallet, zeroAddress, resolver, 0n, this.expiry(),
        ]);
        await this.send(resolver, resolverAbi, "multicall", [[setAddress(name, wallet)]]);
      }
      return name;
    });
  }

  setDocketStatus(docketName: string, status: string, by: "operator" | "moderator"): Promise<void> {
    return this.queue.run(async () => {
      const account = by === "moderator" ? this.options.moderator : this.operator;
      if (!account) throw new AppError(503, "moderator_key_missing", "No moderator key is configured.");
      const resolver = await this.docketResolver(docketName);
      await this.send(resolver, resolverAbi, "setText", [dnsEncode(docketName), TEXT_KEYS.status, status], account);
    });
  }

  setDocketArchive(docketName: string, swarmRef: string): Promise<void> {
    return this.queue.run(async () => {
      const resolver = await this.docketResolver(docketName);
      await this.send(resolver, resolverAbi, "setText", [dnsEncode(docketName), TEXT_KEYS.swarm, swarmRef]);
    });
  }
}
