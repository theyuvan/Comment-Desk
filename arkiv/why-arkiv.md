# Why Arkiv

## What users lose if this were Postgres

**The independent recount.** On Comment Desk, your browser reads every comment straight from Arkiv's public endpoint and reproduces the tally with no key and no call to our server. With Postgres, the only source of the numbers would be the operator claiming them. That is the failure this product exists to fix: a portal asking people to trust its count.

**Comments that cannot be quietly changed.** Comments are created with Arkiv's `readonly` flag, so not even our publisher wallet can edit one after it posts. A Postgres admin can rewrite any row.

**Attribution we cannot forge later.** Reads are scoped to `$creator`, which is fixed when an entity is created. A recount can confirm exactly which publisher wrote each record.

**Expiry we cannot forget to run.** A comment expires at its docket's exact block, enforced by the chain. In Postgres this would be a cron job, and a missed run would keep data past its stated lifetime.

## What we kept off Arkiv, and why

| Kept off | Where it is | Why |
| --- | --- | --- |
| Raw wallet addresses | Only a hash reaches entities | Everything on Arkiv is public. |
| Raw signatures | Only their hash is stored | A signature would reveal the wallet behind the hash. |
| The permanent case file | Swarm | Arkiv entities have a maximum lifetime, and a closed record should outlast them. |
| Human-readable identity | ENS | Names need resolution and access control, which ENS provides. |

## Honest gaps

- Comment text is public plaintext. Field-level encryption is not built.
- Every entity is signed by one publisher wallet. `$creator` proves we published a record, not that a given person wrote it. Authorship rests on the World proof reference on each comment (`idkit:` for typed, `agentpass:` for agent-drafted), which the backend checks before publishing. Comments are not signed by the member's own wallet yet, so the publisher could still invent one.
- ENS ownership is public, so a member's name links openly to their wallet. The hash stops casual scanning of Arkiv, not someone who starts from an ENS name.
- Members last about 182 days unless renewed. Lifetime Extension is not automated yet.
