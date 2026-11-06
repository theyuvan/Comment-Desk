import { bytes, defineSchema, i32, str, u64 } from "@arkiv-network/sdk/schema";

/**
 * Only filter columns are indexed. str() holds at most 128 bytes, so long text
 * lives in bytes() columns. Everything here is public: see the raw-wallet rule
 * in store.ts before adding a field.
 */

export const MemberSchema = defineSchema("commentdesk_member_v1", {
  op_id: str().indexed(),
  owner_hash: str().indexed(),
  nullifier_hash: str().indexed(),
  ens_name: str().indexed(),
  proof_ref: str(),
  join_policy_key: str(),
  joined_at: u64().indexed(),
});

export const PolicyAcceptanceSchema = defineSchema("commentdesk_policy_acceptance_v1", {
  op_id: str().indexed(),
  owner_hash: str().indexed(),
  policy: str().indexed(),
  policy_version: str(),
  /** A hash: a raw signature would let anyone recover the wallet behind owner_hash. */
  signature_hash: str(),
  accepted_at: u64().indexed(),
});

export const DocketSchema = defineSchema("commentdesk_docket_v1", {
  op_id: str().indexed(),
  owner_hash: str().indexed(),
  ens_name: str().indexed(),
  status: str().indexed(),
  credential_level: str().indexed(),
  deadline: u64().indexed(),
  created_at: u64().indexed(),
  title: str(),
  /** JSON: { question, topics }. */
  body: bytes(),
  ruling: bytes().optional(),
  ruling_hash: str().optional(),
  closed_at: u64().optional(),
  swarm_ref: str().optional(),
});

export const CommentSchema = defineSchema("commentdesk_comment_v1", {
  op_id: str().indexed(),
  docket_key: str().indexed(),
  topic: str().indexed(),
  owner_hash: str().indexed(),
  author_type: str().indexed(),
  sentiment: str().indexed(),
  submitted_at: u64().indexed(),
  ens_name: str(),
  author_ens: str(),
  proof_ref: str(),
  ordinal: i32(),
  stance_hash: str(),
  stance: bytes(),
});
