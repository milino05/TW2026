# Visit v2 migration note

`VisitV2` / `VisitRevisionV2` are temporary Mongoose names used only while generator and session/runtime still consume the museum-centric Visit aggregate. The Domain Model name remains `Visit` / `VisitRevision`; final cutover removes the suffix and the legacy aggregate.

The v2 Visit contract is intentionally independent from `official/community`, `Museum`, `spatialMode` and layout snapshots:

- ownership is `User | Organization`;
- `EditorialSource` pins an immutable `EditorialRelease`;
- `ContentEntry` pins `Item + ItemEdition + ItemRevision` and optionally points to a `deliveryAnchorId`;
- `VisitAnchor` is a stable occurrence in the itinerary and points to a `VenueTarget`;
- multiple ContentEntry can share one anchor, an entry may have no anchor, and the same VenueTarget may appear through multiple distinct anchors;
- logistics connect anchors and never persist `LayoutRevision`, coordinates or planned indoor paths;
- a detached copy creates a new Visit lineage and remaps every Visit-local subdocument ID while structurally sharing immutable editorial pins and stable VenueTarget references;
- source Visit updates never propagate to a detached copy;
- physical state is not frozen by Visit: future sessions resolve and pin current published `VenueRelease` state.

The temporary API is `/api/v2/visits` because `/api/visits` is still occupied by the legacy runtime. It will become the canonical `/api/visits` boundary when generator/session migration removes the old aggregate.

Visibility/discoverability and entitlement are deliberately not defined here. Until that separate policy exists, v2 Visit authoring APIs are authenticated and copying is restricted to source Visits the actor can currently manage. The policy boundary can later be widened without changing detached-copy semantics.
