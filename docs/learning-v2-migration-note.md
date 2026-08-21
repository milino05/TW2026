# Learning v2 migration note

Il learning v2 separa gli scope che nel legacy sono ancora mescolati attorno a `Museum` e `Item`.

## Mapping canonico

- `UserSubjectAffinity`: interesse globale verso un `Subject`.
- `UserSubjectKnowledge`: conoscenza globale del `Subject`.
- `UserItemEditionAffinity`: preferenza verso una specifica interpretazione editoriale (`ItemEdition`).
- `UserContentExposureV2`: esposizione esatta, scoped a `ItemEdition + variantId + representationId`, con `lastItemRevisionId` per provenance/version awareness.
- `UserNamespaceFeatureAffinity`: affinità locale a `Namespace + kind + stable definitionId`; nessun trasferimento per label/key fra Namespace differenti.
- `VenueTargetObservationProfile`: osservazione fisica aggregata per `VenueTarget`, indipendente da Item/Subject affinity.

`UserSemanticAffinity`, `UserKnowledgeState`, il vecchio `UserContentExposure`, `ItemObservationProfile` e `MuseumAdaptiveProfile` restano temporaneamente perché generator/session legacy li consumano ancora. Non sono il modello finale.

Gli algoritmi statistici sani (`recency decay`, EMA, reliability, mediana robusta, contributor hashing/confidence) vengono riusati. Il generator v2 consumerà esclusivamente i nuovi scope nella slice successiva.
