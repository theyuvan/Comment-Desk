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
  CREATOR_DOCKET_KEYS,
  MEMBER_TOKEN_ROLES,
  OPERATOR_DOCKET_KEYS,
  OPERATOR_SUBNAME_ROLES,
  RESOLVER_OWNER_ROLES,
  SEPOLIA,
  TEXT_KEYS,
  factoryAbi,
  resolverAbi,
  userRegistryAbi,
} from "./constants.ts";
import { dnsEncode, docketResolverSalt, ownedResolverSalt, registrySalt } from "./names.ts";

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
 *   maya.commentdesk.eth     non-transferable token, the member's own resolver and registry
 *   rule.maya.commentdesk... token owned by the member, its own PermissionedResolver
 *   comment-1.rule.maya...   records on that resolver, served by wildcard, no token
 *
 * Member registries are emancipated from birth: the operator can only register
 * and renew, so it can never change or delete a name once it exists.
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

  /**
   * Everything a member's name needs exists before the name does, so the
   * operator never needs a role that could touch it afterwards. Each step is
   * skipped if already done, which makes a failed join safe to retry.
   */
  registerMember(label: string, wallet: Address): Promise<string> {
    return this.queue.run(async () => {
      const name = `${label}.${this.rootName}`;
      const root = await this.registryOf(this.rootName);
      const owner = await this.ownerOf(root, label);
      if (owner !== zeroAddress) {
        if (owner.toLowerCase() === wallet.toLowerCase()) return name;
        throw new AppError(409, "handle_taken", `${name} is already taken.`);
      }

      // The member's own resolver. They hold every role and the operator holds none.
      const resolverSalt = ownedResolverSalt(wallet);
      const resolver = await this.predict(resolverSalt);
      if (!(await this.isDeployed(resolver))) {
        const init = encodeFunctionData({
          abi: resolverAbi as Abi,
          functionName: "initialize",
          args: [
            [{ account: wallet, roleBitmap: RESOLVER_OWNER_ROLES }],
            [setAddress(name, wallet), setAddress(`agent.${name}`, wallet)],
          ],
        });
        await this.send(SEPOLIA.verifiableFactory, factoryAbi, "deployProxy", [
          SEPOLIA.permissionedResolverImpl, resolverSalt, init,
        ]);
      }

      const registry = await this.registryOf(name);
      if (!(await this.isDeployed(registry))) {
        const init = encodeFunctionData({
          abi: userRegistryAbi as Abi,
          functionName: "initialize",
          args: [[{ account: this.operator.address, roleBitmap: OPERATOR_SUBNAME_ROLES }]],
        });
        await this.send(SEPOLIA.verifiableFactory, factoryAbi, "deployProxy", [
          SEPOLIA.userRegistryImpl, registrySalt(name), init,
        ]);
      }
      await this.send(registry, userRegistryAbi, "setParent", [root, label]);

      await this.send(root, userRegistryAbi, "register", [
        label, wallet, registry, resolver, MEMBER_TOKEN_ROLES, this.expiry(),
      ]);
      return name;
    });
  }

  openDocket(input: { memberName: string; label: string; wallet: Address; records: DocketRecords }): Promise<string> {
    return this.queue.run(async () => {
      const { memberName, label, wallet, records } = input;
      const name = `${label}.${memberName}`;
      const registry = await this.registryOf(memberName);
      if ((await this.ownerOf(registry, label)) !== zeroAddress) {
        throw new AppError(409, "docket_taken", `${name} already exists.`);
      }

      // Enhanced Access Control, set once in the deployment. During `initialize`
      // the caller is the factory, so it holds text admin for this one transaction
      // and gives it up at the end. Nobody holds it afterwards, so these grants
      // can never be widened by the creator, the operator or a moderator.
      const salt = docketResolverSalt(wallet, name);
      const resolver = await this.predict(salt);
      const grant = (key: string, account: Address) =>
        encodeFunctionData({
          abi: resolverAbi as Abi,
          functionName: "grantSetterRoles",
          args: [textSetter(key), account],
        });
      const init = encodeFunctionData({
        abi: resolverAbi as Abi,
        functionName: "initialize",
        args: [
          [{ account: SEPOLIA.verifiableFactory, roleBitmap: ADMIN_SET_TEXT }],
          [
            setText(name, TEXT_KEYS.status, "open"),
            setText(name, TEXT_KEYS.title, records.title),
            setText(name, TEXT_KEYS.deadline, new Date(Number(records.deadline)).toISOString()),
            setText(name, TEXT_KEYS.topics, records.topics.join(",")),
            setText(name, TEXT_KEYS.credential, records.credentialLevel),
            ...CREATOR_DOCKET_KEYS.map((key) => grant(key, wallet)),
            ...OPERATOR_DOCKET_KEYS.map((key) => grant(key, this.operator.address)),
            ...[...new Set(this.moderatorAddresses())].map((moderator) => grant(TEXT_KEYS.status, moderator)),
            encodeFunctionData({
              abi: resolverAbi as Abi,
              functionName: "revokeRootRoles",
              args: [ADMIN_SET_TEXT, SEPOLIA.verifiableFactory],
            }),
          ],
        ],
      });
      await this.send(SEPOLIA.verifiableFactory, factoryAbi, "deployProxy", [
        SEPOLIA.permissionedResolverImpl, salt, init,
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
      const registry = await this.registryOf(memberName);
      if ((await this.ownerOf(registry, "agent")) === zeroAddress) {
        // The member's resolver already holds this name's record, written when they joined.
        const resolver = (await this.client.readContract({
          address: await this.registryOf(this.rootName),
          abi: userRegistryAbi as Abi,
          functionName: "getResolver",
          args: [labelOf(memberName)],
        })) as Address;
        await this.send(registry, userRegistryAbi, "register", [
          "agent", wallet, zeroAddress, resolver, 0n, this.expiry(),
        ]);
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
