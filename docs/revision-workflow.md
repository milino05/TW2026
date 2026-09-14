# Revision workflow v2

Questo documento descrive il workflow editoriale corrente di ArtAround. Le identità stabili e le snapshot versionate sono separate: `ItemV2 -> ItemEdition -> ItemRevisionV2`, `VisitV2 -> VisitRevisionV2`, `Namespace -> NamespaceRevision` e `Venue -> VenueRelease -> LayoutRevision`.

## Stati condivisi

Le revisioni editoriali che usano il workflow condiviso possono assumere gli stati:

```text
draft
in_review
changes_requested
published
superseded
```

`draft` e `changes_requested` sono modificabili. `in_review` è bloccato fino a ritiro della review, richiesta di modifiche o decisione di un actor autorizzato. Ogni modifica riporta l'integrità a `needs_review`; la publication richiede sempre `integrity.status = valid`.

## Publication personale e publication organizzativa

Il dominio distingue due operazioni, senza usare un generico publish che inventi una review:

- `publishWithoutReview`: per una risorsa `user`-owned; richiede una revisione `draft` integra e scrive soltanto i metadata di publication;
- `approveReviewAndPublish`: per una risorsa `organization`-owned; richiede una revisione `in_review` integra, la capability `*.publish`, registra l'approvazione e pubblica la stessa snapshot.

Di conseguenza una risorsa personale non riceve `review.decision = approved` se nessuna review è avvenuta, mentre una risorsa organizzativa non può saltare `draft -> in_review -> published`.

## Dependency versionate: provenance e revisione effettiva

Le revisioni immutabili conservano la baseline contro cui sono state create tramite campi `authoredAgainst...`. Questi campi sono **provenance di authoring**, non un ordine di continuare a usare per sempre quella revisione come dependency operativa.

Gli aggregate live che dipendono da una lineage versionata conservano una dependency policy separata:

- `follow_current`: la revisione effettiva è la revisione pubblicata corrente della dependency lineage;
- `pinned`: la revisione effettiva rimane lo snapshot autorizzato esplicitamente.

Quando una dependency `follow_current` avanza, un audit semantico verifica l'impatto reale sui riferimenti usati dal consumer. Un cambiamento compatibile aggiorna automaticamente la validazione della dependency senza creare nuove revisioni del consumer. Una reale incompatibilità produce `needs_review`; il consumer live non ricade silenziosamente sulla revisione superseded. Le snapshot storiche e le Session già pinzate restano invece riproducibili con le revisioni esatte che hanno registrato.

## ItemEdition

Una `ItemEdition` possiede `workingRevisionId` e `publishedRevisionId`. L'editor lavora sulla working `ItemRevisionV2`; il consistency check verifica Presentation/Representation, la NamespaceRevision **effettiva** della Edition e i riferimenti Subject. `ItemRevisionV2.authoredAgainstNamespaceRevisionId` registra la baseline usata per creare quella specifica revisione. Per un owner Organization `item.edit`, `item.review` e `item.publish` abilitano separatamente modifica/invio, decisione e pubblicazione. Per un owner User, dopo il consistency check, il proprietario pubblica direttamente.

La publication sostituisce il pointer `publishedRevisionId`, azzera `workingRevisionId` e marca l'eventuale snapshot pubblicata precedente come `superseded`.

## VisitV2

`VisitV2` segue la stessa distinzione User/Organization. La consistency check valida gli snapshot editoriali pinzati, ContentEntry, VisitAnchor/VenueTarget e logistica strutturale. Le Visit Organization-owned usano `visit.edit`, `visit.review` e `visit.publish`; le Visit personali possono essere pubblicate direttamente dopo il controllo.

La publication di una Visit non congela `VenueRelease`, `LayoutRevision`, Place, path indoor, timing runtime o Representation concreta: questi aspetti vengono risolti da `ExecutionPreparation` e dalla Session.

## Namespace

`NamespaceRevision` usa il workflow condiviso. Le revisioni Organization-owned devono passare dalla review prima della publication; quelle User-owned possono essere pubblicate direttamente dopo la validazione delle definizioni.

ItemEdition, SemanticGraph ed EditorialContext conservano la propria dependency policy verso la lineage Namespace. Una nuova NamespaceRevision pubblicata attiva il dependency audit dei consumer live dello stesso owner; i consumer compatibili vengono rivalidati automaticamente contro la nuova current, mentre soltanto quelli che usano definizioni diventate incompatibili richiedono intervento. Le revisioni già materializzate non vengono riscritte: il loro `authoredAgainstNamespaceRevisionId` rimane invariato come provenance.

## VenueRelease e LayoutRevision

La Venue appartiene a una Organization. Una working `VenueRelease` incorpora il riferimento a una working `LayoutRevision`; `venue.physical.edit`, `venue.physical.review` e `venue.physical.publish` governano separatamente il workflow. La publication richiede una release `in_review` integra.

Ogni Layout registra con `authoredAgainstPhysicalVocabularyRevisionId` la PhysicalVocabularyRevision usata durante l'authoring. La dependency operativa della Venue vive invece sulla lineage `PhysicalVocabulary` e sulla relativa version policy. Per `follow_current`, il consistency check e i boundary runtime verificano la revisione pubblicata corrente; se il Layout resta semanticamente compatibile, la Venue viene rivalidata senza creare un nuovo Layout. Se non lo è, la dependency passa a `needs_review`.

Il consistency check verifica, tra l'altro, esistenza dei `definitionId`, tipi e applicabilità degli attributi, Floor e calibrazione, geometria e metrica delle Connection, VenueTarget placement e target binding. Alla publication `Venue.publishedReleaseId` viene aggiornato e il Layout associato diventa `published`; gli snapshot precedenti vengono marcati `superseded`. Una nuova revisione del vocabolario non modifica retroattivamente il Layout storico, ma non obbliga nemmeno a creare una nuova bozza quando il consumer corrente è ancora compatibile.

## EditorialRelease

`EditorialRelease` è una snapshot editoriale immutabile, non una revisione con stato draft/in_review. Viene composta da un `EditorialContext`, pinza `NamespaceRevision`, `SemanticGraphRevision` e `ItemRevisionV2`, e registra direttamente `releasedAt/releasedBy` dopo i controlli di composizione. Non va confusa con il workflow di publication degli aggregate revisionabili.

Una `EditorialRelease` è quindi un caso intenzionalmente diverso da un `EditorialContext` live: la release continua a essere interpretata con le revisioni esatte che ha pinzato, mentre un Context `follow_current` deve essere rivalidato contro la NamespaceRevision corrente prima di un nuovo uso live.

## Boundary client

Marketplace/Editor non ricostruisce authorization o transizioni dal ruolo, dall'ownerType o dallo stato grezzo. Le projection backend espongono `availableOperations[]` e il client invia i command `workflow.*` disponibili. Publication editoriale e commercializzazione Marketplace (`Listing`/`Offer`) restano lifecycle distinti.

## Consistenza delle publication

Le publication esistenti conservano compare-and-set e compensazione applicativa sui pointer stabili. Il sottosistema Organization RBAC usa invece transazioni MongoDB e richiede un replica set, come descritto in `organization-rbac.md`.

Gli audit di dipendenza post-commit restano separati dal commit logico della publication, ma riusano lo stesso analyzer dei boundary live. Il publisher aggiorna la propria lineage; il fan-out rivalida soltanto consumer live dello stesso owner. Consumer cross-organization `follow_current` vengono rivalidati nel proprio boundary d'uso, mentre le dependency `pinned` restano sullo snapshot autorizzato.
