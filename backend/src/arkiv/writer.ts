import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { createWalletClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { http, type Hex, type LocalAccount } from "viem";
import { getGasPrice } from "viem/actions";
import { AppError, SerialQueue } from "../core.ts";
import { estimateWrite, publicClientFor, type UnsignedWallet } from "./estimate.ts";
import { WriteGuard } from "./write-guard.ts";

type Phase = "submitting" | "confirmed" | "uncertain" | "acknowledged";
type JournalEntry = { opId: Hex; kind: string; phase: Phase; nonce?: number; txHash?: string; at: number };

/** Append-only and fsynced, so a crash mid-write cannot lose track of a submission. */
class Journal {
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }

  append(entry: Omit<JournalEntry, "at">): void {
    const fd = openSync(this.path, "a");
    try {
      writeSync(fd, `${JSON.stringify({ ...entry, at: Date.now() })}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  /** Writes that started and never reached a final state. */
  unresolved(): JournalEntry[] {
    if (!existsSync(this.path)) return [];
    const open = new Map<string, JournalEntry>();
    for (const line of readFileSync(this.path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line) as JournalEntry;
      if (entry.phase === "confirmed" || entry.phase === "acknowledged") open.delete(entry.opId);
      else open.set(entry.opId, entry);
    }
    return [...open.values()];
  }
}

const MIN_GAS = 1_000_000n;

/**
 * The only path to an Arkiv write. One signer, one queue. An ambiguous send is
 * never retried: the transaction may have landed, so writes pause until the
 * outcome is known, and WriteGuard works that out from the chain. Provider
 * errors are dropped because they can contain the keyed RPC URL.
 */
export class ArkivWriter {
  readonly account: LocalAccount;
  readonly reader: ReturnType<typeof publicClientFor>;
  private readonly wallet: ReturnType<typeof createWalletClient>;
  private readonly queue = new SerialQueue();
  private readonly journal: Journal;
  private readonly guard = new WriteGuard();
  private isOnChain: (opId: Hex) => Promise<boolean> = async () => false;

  constructor(
    private readonly options: {
      account: LocalAccount;
      accessKey: string;
      maxFeeWei: bigint;
      journalPath: string;
    },
  ) {
    this.account = options.account;
    this.reader = publicClientFor(options.accessKey);
    this.wallet = createWalletClient({
      account: options.account,
      chain: rabdi({ accessKey: options.accessKey }),
      transport: http(undefined, { retryCount: 0, timeout: 60_000 }),
    });
    this.journal = new Journal(options.journalPath);
  }

  /** Call once at startup with a way to look an operation up on Arkiv. */
  async reconcile(isOnChain: (opId: Hex) => Promise<boolean>, acknowledge: boolean): Promise<void> {
    this.isOnChain = isOnChain;
    for (const entry of this.journal.unresolved()) {
      if (acknowledge) this.journal.append({ opId: entry.opId, kind: entry.kind, phase: "acknowledged" });
      else this.guard.hold(entry);
    }
    await this.settleHeldWrites().catch(() => {});
  }

  private async settleHeldWrites() {
    const address = this.account.address;
    const settled = await this.guard.settle({
      isOnChain: this.isOnChain,
      latestNonce: () => this.reader.getTransactionCount({ address, blockTag: "latest" }),
    });
    for (const { opId, kind, outcome } of settled) {
      this.journal.append({ opId, kind, phase: outcome === "landed" ? "confirmed" : "acknowledged" });
      console.warn(`[arkiv] ${kind} ${opId} ${outcome === "landed" ? "landed" : "never landed"}, writes continue`);
    }
  }

  execute<T extends { txHash: Hex }>(
    op: { opId: Hex; kind: string },
    prepare: (wallet: UnsignedWallet) => Promise<unknown>,
    send: (
      wallet: UnsignedWallet,
      params: { nonce: number; gas: bigint; gasPrice: bigint },
    ) => Promise<T>,
  ): Promise<T> {
    return this.queue.run(async () => {
      if (this.guard.holding) {
        await this.settleHeldWrites().catch(() => {});
        if (this.guard.holding) {
          throw new AppError(503, "arkiv_write_settling", "An earlier write is still settling. Try again in a moment.");
        }
      }
      const params = await this.prepareParams(prepare);

      this.journal.append({ ...op, phase: "submitting", nonce: params.nonce });
      let result: T;
      try {
        result = await send(this.wallet as never, params);
      } catch (error) {
        const txHash = (error as { txHash?: string }).txHash;
        this.journal.append({ ...op, phase: "uncertain", nonce: params.nonce, txHash });
        this.guard.hold({ ...op, nonce: params.nonce, at: Date.now() });
        throw new AppError(502, "arkiv_write_uncertain", "Arkiv did not confirm this write. Try again in a moment.");
      }

      const receipt = await this.reader.getTransactionReceipt({ hash: result.txHash }).catch(() => undefined);
      if (receipt && receipt.status !== "success") {
        this.journal.append({ ...op, phase: "uncertain", nonce: params.nonce, txHash: result.txHash });
        this.guard.hold({ ...op, nonce: params.nonce, at: Date.now() });
        throw new AppError(502, "arkiv_write_reverted", "Arkiv reverted this write.");
      }
      this.journal.append({ ...op, phase: "confirmed", nonce: params.nonce, txHash: result.txHash });
      return result;
    });
  }

  private async prepareParams(prepare: (wallet: UnsignedWallet) => Promise<unknown>) {
    let estimate: bigint;
    try {
      estimate = await estimateWrite(this.account, this.options.accessKey, prepare);
    } catch {
      // Nothing was sent, so this one is safe to surface and retry.
      throw new AppError(503, "arkiv_preflight_failed", "Arkiv could not estimate this write. Check the wallet is funded.");
    }

    const gas = 2n * estimate > MIN_GAS ? 2n * estimate : MIN_GAS;
    const address = this.account.address;
    const [block, latest, pending, gasPrice, balance] = await Promise.all([
      this.reader.getBlock({ blockTag: "latest" }),
      this.reader.getTransactionCount({ address, blockTag: "latest" }),
      this.reader.getTransactionCount({ address, blockTag: "pending" }),
      getGasPrice(this.reader),
      this.reader.getBalance({ address, blockTag: "latest" }),
    ]);
    if (gas > block.gasLimit / 2n) throw new AppError(422, "arkiv_write_too_large", "This write is too large.");
    if (latest !== pending) throw new AppError(503, "arkiv_nonce_busy", "A previous Arkiv write is still pending.");
    const maxCost = gas * gasPrice;
    if (maxCost > this.options.maxFeeWei) throw new AppError(503, "arkiv_fee_over_budget", "Arkiv fees are over budget.");
    if (maxCost > balance) throw new AppError(503, "arkiv_wallet_unfunded", "The Arkiv wallet needs testnet GLM.");
    return { nonce: latest, gas, gasPrice };
  }
}
