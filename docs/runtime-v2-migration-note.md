# Visit runtime v2 migration note

Slice 10 introduces the v2 execution boundary without replacing the legacy runtime yet.

## Physical execution invariant

A Visit and a GeneratedVisitPlan reference stable `VenueTarget` identities but do not own the physical state used during execution. At Session start, every involved target is resolved against the Venue's current published `VenueRelease`; the Session pins `{ venueId, venueReleaseId, layoutRevisionId }`. All subsequent route resolution uses those exact pins. Publishing a newer VenueRelease therefore affects new Sessions, never an already-started Session.

The generation-time `sourceVenueReleaseIds` and `sourceLayoutRevisionIds` in `GeneratedVisitPlanV2` remain provenance/planning snapshot data; they are not execution authority.

## Editorial and presentation execution

The SessionPlan keeps the Visit/GeneratedPlan's exact Item, ItemEdition, ItemRevision and EditorialRelease references. Each Session ContentEntry also pins the `NamespaceRevision` supplied by its EditorialRelease. Runtime presentation may move among Representations of the same pinned ItemRevision using the ordered DurationType and LanguageLevel definitions of that pinned NamespaceRevision. It never matches local definitions by labels or keys across Namespaces.

The current Navigator projection exposes the effective text and metadata together with authoritative `availableActions`. This is intentionally an application capability boundary so future teacher/student synchronized sessions can restrict navigation commands server-side without hardcoding role rules in the UI.

## Navigation

Runtime route-to-intent uses only the Session-pinned LayoutRevision. The 18-24 runtime does not infer user position: it routes from the current logical VisitAnchor or from an explicitly supplied Place. QR/geolocation remain future location providers for 18-33.

## Learning

Reliable content experiences can be flushed to `UserContentExposureV2` only when the user enabled personal history. Reliable physical observations can contribute to `VenueTargetObservationProfile` only when collective contribution is enabled. Legacy Museum-scoped routing-learning aggregation is not reused by the v2 runtime.

## Transitional scaffolding

`VisitSessionV2`, `SessionPlanRevisionV2` and `/api/v2/visit-sessions` coexist with the legacy Museum/Item runtime until the final cutover. No compatibility mapper is introduced between their internal models.

Runtime replanning/plan-change proposals are deliberately not migrated in this slice. The versioned SessionPlan aggregate preserves the extension point, while 18-24 requirements are covered by execution, presentation adaptation and logistics. Future dynamic tail regeneration can consume Generator v2 directly.

Visit visibility/discoverability is not decided here. The current execution access check is isolated in `visitExecutionAccessV2.service.js` so entitlement/visibility policy can replace the conservative owner/Organization-member rule without changing the Session domain.
