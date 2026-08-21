# Semantic graph v2 migration note

Durante il refactoring `refactor/domain-v2` coesistono temporaneamente due graph:

- il legacy `SemanticEdge` Item/museum-scoped, ancora consumato da Visit/generator/learning non migrati;
- il graph v2 canonico `SemanticGraphRevision` + `GraphSubjectBinding` + `SemanticEdgeV2`, Subject-based e EditorialContext-scoped.

`SemanticEdgeV2` usa temporaneamente un model/collection distinti per evitare collisioni con il legacy. Il contratto finale resta `SemanticEdge`; lo scaffolding `V2` deve essere eliminato quando l'ultimo consumer del graph legacy viene migrato.

Il graph v2 e composto da snapshot immutabili. Non usa `MuseumSemanticGraphState`, epoch o cache invalidation: la cache applicativa e indicizzata per `graphRevisionId`, che non muta.

Una `EditorialRelease` pinna una GraphRevision, una NamespaceRevision e ItemRevision immutabili. `EditorialContext.publishedReleaseId` indica la release operativa corrente ma non implica discoverability pubblica.
