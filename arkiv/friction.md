# Arkiv feedback

Nothing on Arkiv broke while we built this. Our smoke test passed all 12 checks on its first run against Rabdi, covering creates, reads, a patch and a public recount. These are the things that slowed us down.

## What got in our way

**1. A safe write takes a lot of our own code.** Rabdi's gas estimates can run low, so the guidance is to estimate unsigned, double it, read the nonce and gas price, check the half-block limit, and verify the receipt. We ended up with about 250 lines across [estimate.ts](../backend/src/arkiv/estimate.ts) and [writer.ts](../backend/src/arkiv/writer.ts) before our first entity. A wrong step here costs funds or loses a write, so this is where a mistake hurts most.

*What would help:* a `safeWrite` helper in the SDK that does this by default and returns a clear outcome: confirmed, reverted or unknown.

**2. There is no uniqueness guarantee.** One identity per human is a core rule for us, and Arkiv has no unique constraint. We check with a query and then write, so two simultaneous requests could both pass. We serialize these in a single process, which means the backend cannot scale past one instance.

*What would help:* a create that fails if an indexed value already exists, or an insert keyed on a caller-chosen ID.

**3. The maximum lifetime surprised our design.** We planned for members that never expire. Rabdi's limit is 7,884,000 blocks, about 182 days, so anything long-lived needs a job to extend it. We found this in the docs before writing code, but it changed our schema.

*What would help:* permissionless renewal tooling, or a documented pattern for keeping a set of entities alive.

**4. Reading from a browser has no good key option.** Access keys go in the URL path, so we cannot ship one to the browser. Our recount page uses the keyless public endpoint, which is heavily rate limited, and the page has no way to get more capacity.

*What would help:* read-only public keys that are safe to put in a frontend, limited by origin.

## Something we wish existed

An entity-level way to prove who authored a record when a shared publisher signs on behalf of users. We hash the user's wallet into a column, but nothing on Arkiv ties that column to them. A standard pattern for attested authorship would make multi-user apps much stronger.

## Reproducing a problem

We have no bug to report. To reproduce our writes, follow [backend/README.md](../backend/README.md) and run `npm run smoke:arkiv`.
