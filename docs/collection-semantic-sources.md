# Collection semantic sources

## Status

Architectural decision for Marketplace collection authoring.

This document defines the domain boundary between a Collection's editable semantic graph and reusable semantic graph sources. It complements the official project requirements: Marketplace remains museum-generic, contents remain scalable and selectable independently, and semantic authoring must not couple one Collection's mutable state to another Collection.

## Domain model

### Local graph

Every `EditorialContext` (Collection) owns exactly one local `SemanticGraph`.

The local graph is created atomically with the Collection, uses the Collection's `Namespace`, belongs to the same owner/workspace, and is the only semantic graph the Collection may edit.

A new Collection always starts with a new empty local graph. Choosing an existing graph is not part of Collection creation.

### Semantic source pin

An `EditorialGraphImportSource` is a read-only pin from a Collection to one precise revision of another compatible `SemanticGraph`.

A pin records:

- the target Collection/local graph;
- the source semantic graph;
- the pinned source graph revision;
- who created the pin.

A Collection may have multiple source pins, but at most one pin for each source semantic graph. The local graph can never pin itself.

The source graph may continue to evolve in its own authoring context. The consuming Collection keeps reading the pinned revision until the user explicitly updates the pin. No source update is automatic.

### Local edge suppression

An `EditorialGraphEdgeSuppression` records that an edge offered by one or more pinned sources has been intentionally excluded from the Collection's local graph.

The suppression belongs to the Collection/local graph and is keyed by canonical semantic edge identity. It does **not** belong to a specific source.

This means that deleting an imported edge only changes the local graph. It never mutates a source snapshot. If another pinned source offers the same semantic edge, the same local suppression still prevents automatic re-materialization until the user explicitly restores it.

## Invariants

1. **One local graph per Collection.** `EditorialContext.semanticGraphId` is the only editable graph for that Collection.
2. **Creation is always local-first.** Creating a Collection always creates a new empty local graph; source selection happens later in `Collegamenti`.
3. **Namespace compatibility.** Local graph and every pinned source graph use the same `Namespace` as the Collection.
4. **Owner compatibility.** A source graph must be usable inside the same operating owner/workspace as the Collection.
5. **No self-source.** A local graph cannot be pinned as its own source.
6. **One pin per source graph.** A Collection cannot pin two revisions of the same source graph simultaneously.
7. **Pinned revision is immutable from the consumer.** Source authoring APIs are never used through a Collection source pin.
8. **No automatic source update.** A newer source revision is only adopted through an explicit update command.
9. **Global Subject identity.** The same `Subject` appearing in multiple sources is one local Subject, identified by `subjectId`; it is never duplicated per source.
10. **Local content containment.** A Subject can be active in a Collection's local graph only when the Collection contains at least one Item representing that Subject.
11. **Local classification is authoritative.** The first activation may seed Subject classes from the chosen source. A later source never silently overwrites classes already established in the local graph. Conflicting source classes are advisory information for the UI.
12. **Union of source knowledge.** After content import activates Subjects, all pinned source revisions are considered for eligible edges whose endpoints are active locally.
13. **Canonical edge deduplication.** A semantic edge exists at most once in the local graph. Symmetric relation types use orientation-independent identity; directed relation types preserve orientation.
14. **Source support is derived.** An imported local edge may be supported by one or more pinned source revisions. Support is derived by matching its canonical identity against pinned snapshots; it is not duplicated as mutable source state on the local edge.
15. **Local deletion only.** Deleting or replacing a source-supported edge modifies only the local graph and records a local suppression for the old canonical edge identity.
16. **Suppression survives multi-source overlap.** If the same edge exists in more than one pinned source, one local suppression excludes it regardless of which source would otherwise re-offer it.
17. **Explicit restore.** A suppressed edge is restorable while at least one pinned source still supports it and both endpoint Subjects are active locally. Restore removes the suppression and re-materializes the edge in the local graph.
18. **Manual add can supersede suppression.** Explicitly creating the same semantic edge locally removes the corresponding suppression; the resulting edge is local/human-authored.
19. **Updating a source is additive to local semantics.** Updating a pin may materialize newly available, non-suppressed edges between already-active Subjects. It never deletes local Subjects, local classes, local Items, or local edges merely because the newer source revision removed them.
20. **Detaching a source is non-destructive.** Removing a source pin does not remove content, Subjects or edges already present in the local graph. It only removes that source as future support/import material.
21. **Publication depends on the local graph.** Review and publication freeze the Collection and its local graph revision. Runtime consumption never depends on mutable source graphs.
22. **Pagination boundaries stay server-side.** Source discovery exclusions and compatibility filters are applied before count/skip/limit.

## Commands

### Create Collection

Input: Collection details, ContentSpace, Namespace.

Effect: create empty local SemanticGraph + initial revision + EditorialContext in one transaction.

### Add source

Input: source SemanticGraph.

Effect: pin its current working revision. No contents, Subjects or edges are imported by this command.

### Import contents from source

Input: source pin + selected Item IDs from the current ContentSpace.

Effect:

1. add missing Items to the Collection;
2. activate their Subjects locally;
3. seed classes only for newly activated Subjects;
4. inspect **all** pinned source snapshots;
5. materialize every eligible, non-suppressed, non-duplicate edge between active local Subjects.

### Remove local edge

Effect: remove the edge from the local graph. If any pinned source supports the same canonical edge, upsert one local suppression.

### Restore local edge

Effect: if at least one pinned source still supports the suppressed identity and both endpoints are active, recreate one local imported edge and remove the suppression.

### Update source

Effect: replace the pin's revision with the source graph's current working revision through an explicit user action, then materialize newly eligible non-suppressed edges. Existing local semantics are never removed automatically.

### Detach source

Effect: remove the pin only. Imported/local state remains untouched.

## Multi-source examples

If source A and source B both contain Subject `Leonardo da Vinci`, importing that Subject from either source activates the same global Subject once.

If both sources contain `Leonardo --ha creato--> Gioconda`, the local graph contains one edge. Source support is derived as `{A, B}`.

If source A and source B propose different classes for the same already-active Subject, neither source overwrites the local classification. The UI may expose the disagreement, but the Collection remains authoritative.

If an imported edge supported by A and B is deleted locally, one suppression hides it. The UI can show that the excluded relation is still available from A and B and offer `Ripristina`.
