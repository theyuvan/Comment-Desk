# contracts/

ENSv2 side of Comment Desk (Sepolia): subname registrar calls for member / docket / comment
names, Enhanced Access Control for the Moderator `status` role, and a Permissioned Resolver
per docket subname.

Not built yet — this directory belongs to the ENS/Arkiv half of the work split. The World ID
half (`backend/src/world/`, `frontend/src/world/`) never calls ENS directly; it hands verified
results to the `WorldGateHost` interface in `shared/src/world-gate.ts`, and the ENS/Arkiv code
implements that interface.
