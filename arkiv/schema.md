# Arkiv schema

Comment Desk writes to Rabdi (chain 7794095) with `@arkiv-network/sdk` 1.0.1. The schemas are in [backend/src/arkiv/schemas.ts](../backend/src/arkiv/schemas.ts).

**Publisher wallet:** `0x4C16bF7e5267530D8185A92B8CA6ec11cCb85310`. It is `$creator` and `$owner` of every entity. People are identified by the `owner_hash` column, a domain-separated keccak256 of their wallet.

| Entity | Schema | Filtered fields | Stored fields | Who can edit | Expires |
| --- | --- | --- | --- | --- | --- |
| Member | `commentdesk_member_v1` | `op_id`, `owner_hash`, `nullifier_hash`, `ens_name`, `joined_at` | `proof_ref`, `join_policy_key` | Nobody (readonly) | Maximum lifetime, about 182 days |
| Policy acceptance | `commentdesk_policy_acceptance_v1` | `op_id`, `owner_hash`, `policy`, `accepted_at` | `policy_version`, `signature_hash` | Nobody (readonly) | Maximum lifetime, about 182 days |
| Docket | `commentdesk_docket_v1` | `op_id`, `owner_hash`, `ens_name`, `status`, `credential_level`, `deadline`, `created_at` | `title`, `body`, `ruling`, `ruling_hash`, `closed_at`, `swarm_ref` | Publisher, on a request signed by the creator or a moderator | Deadline plus a 7-day grace period |
| Comment | `commentdesk_comment_v1` | `op_id`, `docket_key`, `topic`, `owner_hash`, `author_type`, `sentiment`, `submitted_at` | `ens_name`, `author_ens`, `proof_ref`, `ordinal`, `stance_hash`, `stance` | Nobody (readonly) | The docket's exact expiry block |

## Run a query

Every comment on a docket, with no Comment Desk server involved:

```bash
cd backend && npm install
npm run recount -- <docketKey> 0x4C16bF7e5267530D8185A92B8CA6ec11cCb85310
```

The equivalent SDK query:

```ts
await client
  .select({ $key: true, topic: true, sentiment: true, stance: true })
  .from(CommentSchema)
  .createdBy("0x4C16bF7e5267530D8185A92B8CA6ec11cCb85310")
  .where(eq("docket_key", DOCKET_KEY))
  .limit(50)
  .fetch();
```
