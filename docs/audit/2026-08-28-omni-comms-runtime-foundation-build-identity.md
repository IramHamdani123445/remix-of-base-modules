# Omni-Comms Runtime Delivery Foundation — Build Identity Evidence

Date: 2026-08-28 (UTC)
Project ref: xynceskeiiisiefqlgxo — environment kind: TEST (non_production)

## Provenance (two distinct identities)

| Evidence | Value |
| --- | --- |
| SOURCE_GIT_REVISION (repository provenance) | `99119ddbdd6199b609370dc48d281156c13f9652` |
| OMNI_COMMS_BUILD_REVISION (content-derived runtime package identity) | `c969821569fc4ae4842934414ba0e270c2c13401` |
| OMNI_COMMS_BUILD_SOURCE_FILE_COUNT | 46 |
| Previous build revision | `7f3b0c70d7f13932dd3893feb6ba7be98155ea83` (stale after later source changes) |

The build revision is NOT a Git commit. It is the content hash of
`supabase/functions/omni-comms-runtime/**`, `supabase/functions/omni-comms-dispatch/**`
and `supabase/functions/_shared/omni-comms/**`, excluding the generated artifact region.

## Revision resolution rule (DEF-13)

Canonical resolver: `resolveRevisionReport()` / `resolveDeployedRevision()` in
`supabase/functions/_shared/omni-comms/adapterRegistry.ts`.

- committed build artifact is the default deployment truth;
- a deployment-automation stamp (`OMNI_COMMS_DEPLOYED_REVISION`) is honoured only when
  well formed, and reported as `revisionStale` when it disagrees with the artifact;
- the legacy `OMNI_COMMS_EDGE_REVISION` variable is never consulted.

Environment state (intentional, unchanged this run):
`OMNI_COMMS_DEPLOYED_REVISION = ABSENT`, `OMNI_COMMS_DEPLOYED_REVISION_PENDING = ABSENT`.

## Deployed health (post-deploy verification)

Both `omni-comms-runtime` and `omni-comms-dispatch` report:

```
revision            = c969821569fc4ae4842934414ba0e270c2c13401
revisionVerified    = true
revisionSource      = build_artifact
buildRevision       = c969821569fc4ae4842934414ba0e270c2c13401
environmentRevision = null
revisionStale       = false
```

Governed deployment evidence recorded via
`public.omni_comms_priv_record_runtime_deployment(...)` →
`omni_comms_runtime_certification.observed_runtime_revision` /
`observed_dispatcher_revision` = the value above, `observed_at = 2026-08-28T12:37:33Z`.

`certified_commit` remains `3bce9462e4aad97faab772c73bdcd0a6d7440ca3` — deliberately NOT
advanced. Channel re-approval is a separate governed maker-checker phase.

## Permanent guard

- `package.json` script `verify:omni-build-revision`
  (`node scripts/omni-comms/generate-build-revision.mjs --check`).
- CI step "Build revision guard (DEF-13 deployment identity truth)" in
  `.github/workflows/omni-comms-build4a-certification.yml`.
- Repository test `src/__tests__/omni-comms/def13-revision-identity.test.ts` fails when the
  artifact is stale, when the legacy variable reappears, or when the resolver rule regresses.

## Dispatch posture at end of foundation pass

`omni_comms_dispatch_activation.certified_revision = 3bce9462…` (older than the deployed
build) so runtime dispatch remains fail-closed. All historical jobs remain
`is_runnable = false`; held canary jobs remain held; cancelled/quarantined jobs unchanged.
