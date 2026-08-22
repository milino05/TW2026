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

`draft` e `changes_requested` sono modificabili. `in_review` è bloccato fino a ritiro della review, richiesta di modifiche o decisione manageriale. Ogni modifica riporta l'integrità a `needs_review`; la publication richiede sempre `integrity.status = valid`.

## Publication personale e publication organizzativa

Il dominio distingue due operazioni, senza usare un generico publish che inventi una review:

- `publishWithoutReview`: per una risorsa `user`-owned; richiede una revisione `draft` integra e scrive soltanto i metadata di publication;
- `approveReviewAndPublish`: per una risorsa `organization`-owned; richiede una revisione `in_review` integra, registra l'approvazione manageriale e pubblica la stessa snapshot.

Di conseguenza una risorsa personale non riceve `review.decision = approved` se nessuna review è avvenuta, mentre una risorsa organizzativa non può saltare `draft -> in_review -> published`.

## ItemEdition

Una `ItemEdition` possiede `workingRevisionId` e `publishedRevisionId`. L'editor lavora sulla working `ItemRevisionV2`; il consistency check verifica Presentation/Representation, NamespaceRevision di authoring e riferimenti Subject. Per un owner Organization un operator può inviare o ritirare la review e un manager può richiedere modifiche oppure approvare/pubblicare. Per un owner User, dopo il consistency check, il proprietario pubblica direttamente.

La publication sostituisce il pointer `publishedRevisionId`, azzera `workingRevisionId` e marca l'eventuale snapshot pubblicata precedente come `superseded`.

## VisitV2

`VisitV2` segue la stessa distinzione User/Organization. La consistency check valida gli snapshot editoriali pinzati, ContentEntry, VisitAnchor/VenueTarget e logistica strutturale. Le Visit Organization-owned richiedono review manageriale; le Visit personali possono essere pubblicate direttamente dopo il controllo.

La publication di una Visit non congela `VenueRelease`, `LayoutRevision`, Place, path indoor, timing runtime o Representation concreta: questi aspetti vengono risolti da `ExecutionPreparation` e dalla Session.

## Namespace

`NamespaceRevision` usa il workflow condiviso. Le revisioni Organization-owned devono passare dalla review prima della publication; quelle User-owned possono essere pubblicate direttamente dopo la validazione delle definizioni. Gli Item pinzano la `NamespaceRevision` contro cui sono stati authorati.

## VenueRelease e LayoutRevision

La Venue appartiene a una Organization. Una working `VenueRelease` incorpora il riferimento a una working `LayoutRevision`; operator e manager collaborano sullo stesso workflow, ma la publication è sempre un'approvazione manageriale di una release `in_review` integra.

Il consistency check verifica, tra l'altro, PlaceType, routing attribute/canonicalKey, floor, Place, Connection, VenueTarget placement e target binding. Alla publication `Venue.publishedReleaseId` viene aggiornato e il Layout associato diventa `published`; gli snapshot precedenti vengono marcati `superseded`.

## EditorialRelease

`EditorialRelease` è una snapshot editoriale immutabile, non una revisione con stato draft/in_review. Viene composta da un `EditorialContext`, pinza `NamespaceRevision`, `SemanticGraphRevision` e `ItemRevisionV2`, e registra direttamente `releasedAt/releasedBy` dopo i controlli di composizione. Non va confusa con il workflow di publication degli aggregate revisionabili.

## Boundary client

Marketplace/Editor non ricostruisce authorization o transizioni dal ruolo, dall'ownerType o dallo stato grezzo. Le projection backend espongono `availableOperations[]` e il client invia i command `workflow.*` disponibili. Publication editoriale e commercializzazione Marketplace (`Listing`/`Offer`) restano lifecycle distinti.

## Consistenza transactionless

Il progetto deve funzionare con MongoDB standalone. Dove una publication cambia più documenti o pointer, i service conservano lo stato precedente, usano compare-and-set sui pointer stabili e applicano compensazione esplicita se una write del core fallisce. Gli audit di dipendenza post-commit restano separati dal commit logico della publication.
