# LinkedIn guest pilot validation

- [x] User explicitly approved activation of the three guest searches.
- [x] All automated tests passed on the exact commit.
- [x] Production deploy completed with guest sources still inactive.
- [ ] First active hourly round has no `blocked` or `schema_changed` LinkedIn diagnostic.
- [ ] At least one real observation has a valid LinkedIn job URL and explicit entry-level title.
- [ ] No duplicate Telegram delivery was created.
- [ ] Three consecutive blocked or schema-changed rounds trigger source deactivation and review.

## Pre-activation scope

Source IDs: `linkedin-guest:desenvolvedor-java-junior`, `linkedin-guest:desenvolvedor-node-junior`, and `linkedin-guest:desenvolvedor-full-stack-junior`.

Activation was explicitly approved on 2026-10-01. Task diagnostics, real observations, decisions, alert intents and Telegram deliveries are recorded only from normal hourly rounds after the active deployment.

## Inactive deployment evidence

- Commit checked: `86ec503`
- Automated verification: 26 test files, 86 tests passed.
- Production Worker version: `5b11f6f6-ebf0-4809-b9da-a15abb86074c`
- Schedule unchanged: `0 * * * *`.
- The three definitions remain `active: false`; no LinkedIn guest task was created or manually triggered.

## Active pilot deployment evidence

- Activation commit: `247b3e0` (only the guest-source activation configuration and its matching assertion changed).
- Production Worker version: `805b083b-1755-4245-8ca0-9ccbab9cd3a3`.
- Deployment completed at 2026-10-01T10:08:50Z with the existing hourly schedule unchanged.
- No manual discovery or test alert was sent. The first evidence must come from a normal hourly round after this deployment.

## Removal decision

If three consecutive active hourly rounds have a `blocked` or `schema_changed` LinkedIn diagnostic, remove all three guest-source definitions in a separate corrective commit and review the experiment. No retry strategy, alternate host, session state or identity-avoidance measure is permitted.
