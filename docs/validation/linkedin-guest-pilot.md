# LinkedIn guest pilot validation

- [ ] User explicitly approved activation of the three guest searches.
- [ ] All automated tests passed on the exact commit.
- [ ] Production deploy completed with guest sources still inactive.
- [ ] First active hourly round has no `blocked` or `schema_changed` LinkedIn diagnostic.
- [ ] At least one real observation has a valid LinkedIn job URL and explicit entry-level title.
- [ ] No duplicate Telegram delivery was created.
- [ ] Three consecutive blocked or schema-changed rounds trigger source deactivation and review.

## Pre-activation scope

Source IDs: `linkedin-guest:desenvolvedor-java-junior`, `linkedin-guest:desenvolvedor-node-junior`, and `linkedin-guest:desenvolvedor-full-stack-junior`.

The sources stay inactive until explicit approval. Do not enter production evidence before activation: task diagnostics, real observations, decisions, alert intents and Telegram deliveries belong to the controlled active pilot only.

## Removal decision

If three consecutive active hourly rounds have a `blocked` or `schema_changed` LinkedIn diagnostic, remove all three guest-source definitions in a separate corrective commit and review the experiment. No retry strategy, alternate host, session state or identity-avoidance measure is permitted.
