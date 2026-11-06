# Connecting World ID

This backend needs one thing from the World side: an implementation of the `WorldGate` interface in [src/world.ts](src/world.ts). Your code never touches Arkiv or ENS, and this code never calls IDKit or Agent Pass.

## What to build

Implement these three methods. Throw `WorldDenied` when a check fails, and nothing gets written.

```ts
import { WorldDenied, type WorldGate } from "./world.ts";

export const realWorldGate: WorldGate = {
  async verifyJoin({ proof, signal }) {
    // verifyCloudProof against the join action, using this signal
    return { humanVerified: true, proofRef, nullifierHash };
  },
  async verifyHumanComment({ proof, signal, credentialLevel }) {
    return { humanVerified: true, proofRef };
  },
  async verifyAgentConfirm({ proof, draftKey, credentialLevel }) {
    // Throw if expired, or if the confirm does not cover draftKey
    return { agentConfirmed: true, draftKey: confirmedKey, proofRef };
  },
};
```

Then change the one marked line in [src/server.ts](src/server.ts):

```ts
const world = realWorldGate;
```

`proofRef` is public and has a 128-byte limit, so use a short reference. Never put a raw identity in it.

## Denials

| Situation | Throw |
| --- | --- |
| The member cancels | `new WorldDenied("cancelled", "Verification was cancelled.")` |
| Bad proof | `new WorldDenied("invalid_proof", "...")` |
| Nullifier already used | `new WorldDenied("nullifier_reused", "...")` |
| Agent Pass confirm expired | `new WorldDenied("confirm_expired", "...")` |
| Draft changed after the confirm | `new WorldDenied("draft_mismatch", "...")` |

The API returns these as HTTP 403 with `error: "world_<reason>"` and a `reason` field, so the frontend can explain what happened.

The backend also compares `draftKey` itself, so a stale approval is rejected even if your code returns it.

## What the proof is bound to

| Flow | IDKit signal or Agent Pass scope | How the client gets it |
| --- | --- | --- |
| Join | `keccak256(signature)` of the signed `Join` message | Sign first, then hash the signature |
| Human comment | The submission key | `POST /api/dockets/:key/submission-key` |
| Agent comment | The submission key, as the draft key | The same call, with `authorType: "agent"` |

The submission key covers the docket, topic, sentiment, exact text, author type and member. Changing one character changes the key, which is what makes the draft-mismatch denial work.

## Comment flow in the browser

1. Compute `stanceHash = keccak256(utf8(stance))`.
2. Call `POST /api/dockets/:key/submission-key` with `wallet`, `topic`, `sentiment`, `stanceHash` and `authorType`.
3. Run IDKit or Agent Pass with that key.
4. Sign `SubmitComment` with the member's wallet. Types are at `GET /api/typed-data`.
5. Call `POST /api/dockets/:key/comments` with the proof as `worldProof`.

## Two decisions for you

**1. Comment action limits.** The spec allows up to 3 comments per topic, with only the first counted. If the comment action allows one verification per human, World will block the second comment before the backend sees it. Set the comment action to unlimited verifications and let the backend enforce the cap, or tell me if you want one comment per topic and I will set `MAX_COMMENTS_PER_TOPIC=1`.

**2. Join action retries.** If a join fails after your check passes, for example an Arkiv outage, the member has to retry. A one-verification join action would reject that retry. The backend already enforces one identity per human using `nullifierHash`, so set the join action to allow repeat verification. The nullifier must stay the same for a given human, because that is what enforces uniqueness.

## Testing before World is ready

Set `WORLD_GATE=dev` in `.env`. The stand-in accepts everything and marks records `dev:`. For a join it uses `worldProof.subject` as the identity, so two requests with the same `subject` act as one human.

Unit tests use a controllable gate in [test/helpers.ts](test/helpers.ts), and each denial above already has a test in [test/desk.test.ts](test/desk.test.ts).
