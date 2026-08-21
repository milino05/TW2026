# Generator v2 migration note

`GeneratedVisitPlanV2` and `/api/v2/generated-plans` are temporary coexistence names while the legacy generator/session stack still consumes `GeneratedVisitPlan`.

The canonical v2 generator contract is based on two independent scopes:

- **EditorialScope**: explicitly selected `EditorialContext[]`, or the selected Venue `primaryEditorialContextId` values when the request does not supply contexts. The backend resolves and pins the current immutable `EditorialRelease[]`.
- **PhysicalScope**: explicitly selected `Venue[]`. The backend resolves and pins current `VenueRelease[]` and `LayoutRevision[]` for the generated plan.

Local semantic/editorial definitions are never matched by key across Namespace. A local goal is identified by `namespaceId + definitionId`.

Physical candidates originate only from active `VenueTarget` bindings in the selected PhysicalScope. Semantic reachability can score the association of content to an existing physical target, but cannot create a Venue, VenueTarget or physical leg. Multi-Venue movement uses only explicit positive `interVenueTransfers` supplied in the request.

Candidate content originates only from immutable `EditorialRelease.itemBindings`. Exact `ItemEdition + ItemRevision` duplicates across releases are deduplicated with multi-release provenance. Search selects at most one Edition per Item lineage by default.

The generated plan pins a concrete Variant/Representation as a **baseline**, not as a future runtime lock. VisitSession v2 may adapt presentation within the same pinned ItemRevision.

At cutover, after VisitSession/runtime migration:

- `GeneratedVisitPlanV2` becomes `GeneratedVisitPlan`;
- `/api/v2/generated-plans` becomes the canonical generated-plan API;
- the museum-scoped generator, old `GeneratedVisitPlan`, Item graph and vocabulary/layout dependencies are removed.
