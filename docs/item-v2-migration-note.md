# Item v2 migration note

This branch temporarily registers the new canonical Item aggregate as `ItemV2` / `ItemRevisionV2` at the Mongoose model level because the legacy museum-scoped runtime still registers `Item` / `ItemRevision` and is consumed by Visit, graph, layout, learning and generator code that will be migrated in later slices.

The public v2 API is already canonical (`/api/items`, `/api/item-editions`). The `V2` Mongoose suffix and `_v2` collections are migration scaffolding only and must be removed when the final legacy Item consumer is migrated. The final domain model remains `Item -> ItemEdition -> ItemRevision`.
