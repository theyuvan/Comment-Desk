import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * A public receipt for every action: which World check passed, which Arkiv entities were
 * written and which Sepolia transactions were sent, each with something you can look up.
 *
 * Steps are reported where writes happen (ArkivWriter.execute, EnsNaming.send), and land on
 * the action that started them through AsyncLocalStorage, background work included.
 * Nothing secret goes in: only names, hashes, entity keys and proof references.
 */

export type Chain = "world" | "arkiv" | "sepolia" | "swarm";
export type OperationKind = "policy" | "join" | "docket" | "comment" | "ruling" | "moderation";

export type Step = {
  label: string;
  chain: Chain;
  status: "done" | "failed";
  at: number;
  tx?: string;
  entityKey?: string;
  ref?: string;
};

export type Operation = {
  id: string;
  kind: OperationKind;
  subject: string;
  status: "running" | "done" | "failed";
  startedAt: number;
  finishedAt?: number;
  /** Steps planned up front, so a page can show what is still to come. */
  expected: string[];
  steps: Step[];
  error?: string;
};

/** Step labels, shared by the code that plans a step and the code that reports it. */
export const STEP = {
  worldHuman: "World ID verified: one unique human",
  worldAgent: "Approved with World ID Agent Pass",
  memberRecord: "Member record written to Arkiv",
  policyRecord: "Policy acceptance written to Arkiv",
  docketRecord: "Docket record written to Arkiv",
  docketUpdate: "Docket updated on Arkiv",
  commentRecord: "Comment written to Arkiv (read-only)",
  swarmUpload: "Case file uploaded to Swarm",
  resolver: (name: string) => `Resolver for ${name} deployed`,
  docketResolver: (name: string) => `Resolver for ${name} deployed with its role grants`,
  registry: (name: string) => `Registry for ${name} deployed`,
  linked: (name: string) => `${name} linked under its parent`,
  registered: (name: string) => `${name} registered`,
  records: (name: string) => `Records for ${name} written`,
  arkivLink: (name: string) => `${name} pointed at its Arkiv record`,
  status: (name: string, status: string) => `Status of ${name} set to ${status}`,
  swarmPointer: (name: string) => `Swarm pointer on ${name} set`,
} as const;

type Tracked = Operation & { mainDone: boolean; pending: number };

const current = new AsyncLocalStorage<Tracked>();

export class ActivityLog {
  private readonly ops: Tracked[] = [];
  private file: string | null = null;

  constructor(private readonly limit = 300) {}

  /** Keeps receipts across restarts. Operations that were running are marked as interrupted. */
  persistTo(file: string) {
    this.file = file;
    try {
      const saved = JSON.parse(readFileSync(file, "utf8")) as Operation[];
      for (const op of saved) {
        const interrupted = op.status === "running";
        this.ops.push({
          ...op,
          status: interrupted ? "failed" : op.status,
          error: interrupted ? "interrupted by a restart" : op.error,
          mainDone: true,
          pending: 0,
        });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error("[activity] could not read", file);
    }
  }

  private save() {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.ops.map(({ mainDone: _m, pending: _p, ...op }) => op)));
    } catch {
      console.error("[activity] could not save");
    }
  }

  /** Runs one action and collects every step it and its background work report. */
  async track<T>(kind: OperationKind, subject: string, expected: string[], task: () => Promise<T>): Promise<T> {
    const op: Tracked = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      subject,
      status: "running",
      startedAt: Date.now(),
      expected,
      steps: [],
      mainDone: false,
      pending: 0,
    };
    this.ops.unshift(op);
    if (this.ops.length > this.limit) this.ops.length = this.limit;
    this.save();
    try {
      const result = await current.run(op, task);
      op.mainDone = true;
      this.settle(op);
      return result;
    } catch (error) {
      this.fail(op, error);
      throw error;
    }
  }

  /** Reports a step on the action in progress. Outside an action it does nothing. */
  note(step: Omit<Step, "at" | "status"> & { status?: Step["status"] }) {
    const op = current.getStore();
    if (!op) return;
    op.steps.push({ status: "done", ...step, at: Date.now() });
    this.save();
  }

  /** Names the action once its subject is known, e.g. a comment's number. */
  rename(subject: string, expected?: string[]) {
    const op = current.getStore();
    if (!op) return;
    op.subject = subject;
    if (expected) op.expected = expected;
    this.save();
  }

  /** Runs work that belongs to no action on screen, so its steps don't land on this one. */
  untracked<T>(task: () => T): T {
    return current.exit(task);
  }

  /** Keeps the action open until background work finishes; call the result when it does. */
  hold(): (error?: unknown) => void {
    const op = current.getStore();
    if (!op) return () => {};
    op.pending++;
    let released = false;
    return (error?: unknown) => {
      if (released) return;
      released = true;
      op.pending--;
      if (error) this.fail(op, error);
      else this.settle(op);
    };
  }

  private settle(op: Tracked) {
    if (op.status !== "running" || !op.mainDone || op.pending > 0) return this.save();
    op.status = "done";
    op.finishedAt = Date.now();
    this.save();
  }

  private fail(op: Tracked, error: unknown) {
    if (op.status === "failed") return;
    op.status = "failed";
    op.finishedAt = Date.now();
    // Codes only: a raw provider message can contain the keyed Arkiv RPC URL.
    const { code, name } = error as { code?: unknown; name?: unknown };
    op.error = typeof code === "string" ? code : typeof name === "string" ? name : "failed";
    this.save();
  }

  list(filter: { subject?: string; limit?: number } = {}): Operation[] {
    return this.ops
      .filter((op) => !filter.subject || op.subject === filter.subject)
      .slice(0, filter.limit ?? 100)
      .map(({ mainDone: _m, pending: _p, ...op }) => ({ ...op, steps: [...op.steps] }));
  }
}

/** One per process, like the desk itself. */
export const activity = new ActivityLog();
