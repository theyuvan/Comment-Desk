# Arkiv and Swarm

## What lives where

| Layer | What it holds | Why |
| --- | --- | --- |
| Arkiv | Live state: members, policy consents, open dockets, comments and the tally | It has to be queryable now, recountable by anyone, and it expires on schedule. |
| Swarm | One JSON case file per closed docket: the ruling, final tally and every comment | A closed record has nothing left to change and should outlast the entities. |

**The field that holds the reference:** `swarm_ref` on the `commentdesk_docket_v1` entity. The same reference is written to the docket's ENS text record `commentdesk.swarm`, because the Arkiv entity expires a week after the deadline and the pointer should not expire with it.

## A real example

| | |
| --- | --- |
| Arkiv docket entity | `0x37655b1db9c5de5156a2700e4e7eb0ff5407a6edef70258c45d386855f2d7e14` |
| Swarm reference | `9e851f482f84d66dd8c677a7fde343e4e0806263b3e52d8e243ce37e06a121e6` |
| Open the file | <https://api.gateway.ethswarm.org/bzz/9e851f482f84d66dd8c677a7fde343e4e0806263b3e52d8e243ce37e06a121e6/> |
| ENS name holding the same pointer | `truck-rule.maya-mw4s7mf5.commentdesk.eth` |

The Arkiv entity comes from a test run whose World proofs used a development stand-in, and its comments are marked `dev:`. The entity expires about 7 days after its deadline.

## Stamp and service

- **Service:** the public gateway at `https://api.gateway.ethswarm.org`, through the Bee HTTP API.
- **Postage batch:** none of our own. We send the all-zero batch ID, and the gateway stamps the upload itself. No wallet of ours bought a batch.
- **What this means:** we do not control how long the gateway's stamp keeps the file alive. For real durability, set `SWARM_BEE_URL` and `SWARM_BATCH_ID` to your own Bee node and a batch you bought. No code changes.

## Files

- [backend/src/swarm.ts](../backend/src/swarm.ts): upload and read.
- [backend/src/desk.ts](../backend/src/desk.ts): `publishArchive` runs when a docket closes, and `verifyArchive` reads the file back and compares it with Arkiv.

## Run one upload and one read

Read an existing file with no setup:

```bash
curl https://api.gateway.ethswarm.org/bzz/9e851f482f84d66dd8c677a7fde343e4e0806263b3e52d8e243ce37e06a121e6/
```

You should see JSON with the ruling "The rule passes, with a three-year phase-in.", a tally counting 2 of 3 comments, and all 3 comments.

Run a full upload, which needs the backend set up as in [backend/README.md](../backend/README.md):

```bash
cd backend
# set WORLD_GATE=dev in .env first
npm run dev                         # terminal 1
npx tsx --env-file=.env scripts/e2e-live.ts   # terminal 2
```

It closes a real docket, uploads the case file, and prints `PASS file on Swarm matches Arkiv` with the new reference.

## Demo video

TO FILL: the timestamp where the closed docket shows its case file link and "Verified: the file on Swarm matches Arkiv".

## What got in our way

- **Gateway hosts differ.** `gateway.ethswarm.org` answered our upload with `405 Not Allowed`, while `api.gateway.ethswarm.org` accepted it. We found the working host by trying both.
- **Stamps are the hard part for a short event.** The docs' upload walkthrough assumes your own Bee node on Gnosis Chain, with a funded batch. That is a lot of setup for a 2-day hackathon, so we used the gateway and gave up control over retention.
- **No clear retention answer.** We could not find how long a gateway-stamped upload lasts, and that is exactly what a permanent case file needs to know.

## Encrypted references

We upload unencrypted, because the record is public by design. An encrypted Swarm reference contains its key, so `attachArchive` refuses any 128-character reference rather than risk storing a key on Arkiv.
