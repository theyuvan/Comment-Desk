import type {
  CommentCreated,
  CommentProof,
  CommentSubmission,
  DocketInfo,
  HumanVerified,
  JoinRequest,
  MemberCreated,
  WorldGateHost,
} from "@commentdesk/shared";
import { sha256Hex } from "../crypto";

/**
 * PLACEHOLDER for the Arkiv/ENS half — not the real data layer.
 *
 * Lets the World gates run end to end before Arkiv entities and ENSv2 minting exist.
 * Replace with the real host (write `member` / `comment` entities, mint subnames) by
 * passing it to `buildApp`. Nothing here is persisted or public.
 */
export interface StubComment {
  commentRef: string;
  ensName: string;
  docketKey: string;
  topic: string;
  text: string;
  authorType: "human" | "agent";
  proofRef: string;
  memberEnsName: string;
  createdAt: number;
}

export class StubHost implements WorldGateHost {
  readonly members = new Map<string, { handle: string; ensName: string; proofRef: string }>();
  readonly comments: StubComment[] = [];
  private readonly dockets = new Map<string, DocketInfo>();

  constructor(dockets: DocketInfo[]) {
    for (const d of dockets) this.dockets.set(d.key, d);
  }

  static withDemoDockets(now = Math.floor(Date.now() / 1000)): StubHost {
    const week = 7 * 24 * 3600;
    return new StubHost([
      {
        key: "truck-emissions-rule",
        title: "Proposed heavy-duty truck emissions rule",
        topics: ["emission-limits", "phase-in-timeline", "enforcement"],
        credentialLevel: "strict",
        status: "open",
        deadline: now + week,
        ensName: "truck-emissions-rule.demo.commentdesk.eth",
      },
      {
        key: "community-garden-hours",
        title: "Should the community garden open on weekday evenings?",
        topics: ["opening-hours", "volunteer-staffing"],
        credentialLevel: "soft",
        status: "open",
        deadline: now + week,
        ensName: "community-garden-hours.demo.commentdesk.eth",
      },
    ]);
  }

  async getDocket(key: string) {
    return this.dockets.get(key) ?? null;
  }

  async onMemberVerified(proof: HumanVerified & { purpose: "join" }, join: JoinRequest): Promise<MemberCreated> {
    for (const m of this.members.values()) {
      if (m.handle === join.handle) throw new Error(`${join.handle}.commentdesk.eth is taken`);
    }
    const memberRef = `member_${sha256Hex(proof.proofRef).slice(0, 16)}`;
    const ensName = `${join.handle}.commentdesk.eth`;
    this.members.set(memberRef, { handle: join.handle, ensName, proofRef: proof.proofRef });
    return { memberRef, ensName };
  }

  async onCommentVerified(proof: CommentProof, s: CommentSubmission): Promise<CommentCreated> {
    const docket = this.dockets.get(s.docketKey);
    const n = this.comments.filter((c) => c.docketKey === s.docketKey).length + 1;
    const created: CommentCreated = {
      commentRef: `comment_${sha256Hex(proof.proofRef).slice(0, 16)}`,
      ensName: `comment-${n}.${docket?.ensName ?? s.docketKey}`,
    };
    this.comments.push({
      ...created,
      docketKey: s.docketKey,
      topic: s.topic,
      text: s.text,
      authorType: s.authorType,
      proofRef: proof.proofRef,
      memberEnsName: this.members.get(s.memberRef)?.ensName ?? s.memberRef,
      createdAt: Math.floor(Date.now() / 1000),
    });
    return created;
  }
}
