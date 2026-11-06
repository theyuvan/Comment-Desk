# Reach

## Who is it for, and would they use it?

Comment Desk is for groups that collect public input and need people to believe the result:

- **Regulators and public agencies** running comment periods. Fake comments have hit real decisions: about 18 million of 22 million comments on the FCC's 2017 net-neutrality docket were fake, and CiviClick sent 20,000 AI-written comments to a Southern California air board using real residents' identities.
- **DAOs and communities** making decisions, where one wallet is not one person.

The first users are most likely DAOs and online communities, because they can adopt it without a procurement process and already understand wallets and names. A regulator would need a pilot and legal review, and this mini version has no dispute process.

## Can they try it today?

Yes, on testnets, with real World ID: production World App for joining and commenting, and production World ID Agent Pass for approving agent drafts.

- **Try it:** TO FILL: deployed URL
- **Run it locally:** follow [backend/README.md](../backend/README.md)
- **Recount it without us:** `npm run recount -- <docketKey> <publisher>` in `backend/`

## Will we keep building after Mumbai?

DRAFT — written from the project's own "Honest gaps and future work" list in the main README, not a promise. Edit or replace before submission with your actual plan.

The concrete backlog is already written down, not invented for this answer:

- Comment text isn't encrypted today — field-level privacy on comments needs ZK or FHE, which this stack doesn't have yet.
- One publisher wallet signs every Arkiv entity, so a comment's `$creator` proves we published it, not that a named person wrote it. A recount proves the tally matches the published records, not that every record is genuine. Making that provable (per-member signing, not one shared publisher) is the single change that would matter most to a regulator or DAO actually adopting this.
- Members and policy acceptances expire at Arkiv's ~182-day maximum, and Lifetime Extension isn't automated — a real deployment needs that running unattended.
- A lost passkey has no recovery path, and World ID's one-identity rule blocks rejoining with a new one. That's a real support burden at any scale.
- There's no appeals or dispute process once a Moderator closes a docket early.

Whether we put more hours into this after Mumbai specifically is still an open question for us, not a given — it depends on whether a regulator, DAO or community actually wants to pilot it. The code and the gaps above are real either way.
