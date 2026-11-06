# How we use Arkiv

## Do filters, edit rights and expiry fit the app?

**What we filter on.** Each indexed column backs a real screen or rule, and everything else stays unindexed.

| Filter | Used for |
| --- | --- |
| `docket_key` | Loading a docket's record and recounting it |
| `owner_hash` + `topic` + `docket_key` | Enforcing the limit of 3 comments per topic |
| `nullifier_hash` | One identity per human |
| `ens_name` | Handle and docket-name uniqueness |
| `op_id` | Finding a write again after a crash or a repeated request |
| `status` | Browsing dockets |
| `$creator` | Every query, so copied schema tags cannot enter a tally |

**Who can edit what.** Comments, members and policy acceptances are readonly, because a public record that could change would be worthless. Dockets stay mutable on purpose, because their status, ruling and Swarm reference change as the case concludes. The backend only makes those edits on a request signed by the creator or a listed moderator.

**When things expire.** The README's first draft said members never expire, but Rabdi has no permanent option, so members use `ExpirationTime.max()`. A docket expires a week after its deadline, which gives the creator time to publish a ruling. Comments use `ExpirationTime.atBlock(docket.$expiresAt)`, so they leave Arkiv together with their docket. The case file on Swarm is what remains.

## Does each feature change something users see?

| Arkiv feature | What the user sees |
| --- | --- |
| Filtered queries | The docket browser and each docket's comment list |
| Direct public reads | The recount page, which reads Arkiv from the visitor's browser and shows whether it matches our tally |
| `readonly` | A posted comment has no edit option, and none exists at any layer |
| `$creator` | The recount reports one publisher and cannot be polluted by copied entities |
| Patching | A docket moves from open to closed, and shows its ruling and case file |
| Block-based expiry | The docket page shows the deadline, and closed records move to Swarm before the comments expire |
| Bytes columns | Full comment and ruling text, beyond the 128-byte `str()` limit |
