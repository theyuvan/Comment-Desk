import { AppError } from "./core.ts";

/** Services depend on this, so they can be tested without a network. */
export interface Archiver {
  /** A link anyone can open. */
  urlFor(reference: string): string;
  upload(name: string, json: string): Promise<string>;
  read(reference: string): Promise<string>;
}

/** Lets a public gateway choose its own stamp. Your own Bee node needs a real batch ID. */
export const GATEWAY_BATCH_ID = "0".repeat(64);

/** Talks to the Bee HTTP API, which a local node and the public gateway both serve. */
export class BeeArchiver implements Archiver {
  constructor(
    private readonly options: {
      beeUrl: string;
      batchId: string;
      readUrl?: string;
    },
  ) {}

  urlFor(reference: string) {
    return `${this.options.readUrl ?? this.options.beeUrl}/bzz/${reference}/`;
  }

  async upload(name: string, json: string): Promise<string> {
    const response = await fetch(`${this.options.beeUrl}/bzz?name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "swarm-postage-batch-id": this.options.batchId,
      },
      body: json,
      signal: AbortSignal.timeout(60_000),
    }).catch(() => undefined);
    if (!response?.ok) throw new AppError(502, "swarm_upload_failed", "Swarm did not accept the archive.");
    const { reference } = (await response.json()) as { reference?: string };
    if (!reference) throw new AppError(502, "swarm_upload_failed", "Swarm returned no reference.");
    return reference;
  }

  async read(reference: string): Promise<string> {
    const response = await fetch(this.urlFor(reference), { signal: AbortSignal.timeout(30_000) }).catch(() => undefined);
    if (!response?.ok) throw new AppError(502, "swarm_read_failed", "That archive could not be read from Swarm.");
    return response.text();
  }
}
