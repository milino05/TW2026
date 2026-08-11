# Revisioni e workflow editoriale

## Separazione tra identita e contenuto

`Item`, `Visit` e `MuseumLayout` sono identita stabili. I contenuti modificabili risiedono rispettivamente in `ItemRevision`, `VisitRevision` e `MuseumLayoutRevision`.

Le entita stabili mantengono due puntatori:

```text
publishedRevisionId
workingRevisionId
```

Le API pubbliche leggono esclusivamente `publishedRevisionId`. L'editor usa `workingRevisionId` quando presente.

## Creazione e modifica

La creazione produce l'entita stabile e la revisione `version: 1` in stato `draft`.

Quando un operator modifica un contenuto gia pubblicato e non esiste una revisione di lavoro, il backend clona la revisione pubblicata in una nuova revisione `draft`. La revisione pubblicata continua a essere servita al Navigator.

E ammessa una sola revisione di lavoro per entita.

## Stati

```text
draft
in_review
changes_requested
published
superseded
```

Flusso ufficiale:

```text
draft -> in_review -> published
                  -> changes_requested -> draft
in_review -> draft (ritiro della richiesta)
```

Una revisione `in_review` e bloccata. L'operator deve ritirare la richiesta oppure attendere la decisione del manager. Un manager puo pubblicare direttamente un proprio `draft` integro.

Le visite community non usano la revisione manageriale e seguono `draft -> published`.

## Consistenza e revisione

L'operator puo modificare e lanciare `check-consistency`. Per inviare una revisione al manager non devono esistere errori bloccanti. Ogni richiesta, ritiro, richiesta di modifiche e pubblicazione viene conservata in `review.events`.

La pubblicazione sposta `publishedRevisionId` sulla nuova revisione, azzera `workingRevisionId` e marca la precedente revisione pubblicata come `superseded`.

## Baseline temporale della visita

Una `VisitRevision` pubblicata conserva `baselineTiming`, calcolata al momento della pubblicazione con la versione corrente di `AdaptivePolicy` e i profili appresi disponibili in quel momento.

La baseline e uno **snapshot editoriale immutabile** della revisione. Item, vocabolari o layout che cambiano successivamente possono generare warning o repair draft, ma non riscrivono la baseline storica della VisitRevision gia pubblicata.

Una nuova revisione di lavoro parte invece senza baseline valida e la ricalcola prima della nuova pubblicazione.

Le stime personalizzate mostrate al visitatore non usano la baseline come valore assoluto: vengono calcolate runtime usando i modelli correnti e `VisitTimingProfile`.

## Cestino

Il cestino appartiene all'entita stabile con `lifecycleStatus: active | trashed`. Un operator puo spostare nel cestino item e visite ufficiali; un manager puo ripristinare o cancellare definitivamente. L'hard delete controlla le dipendenze e non effettua cancellazioni a cascata.

## Dipendenze Item -> Visit

Le visite mantengono riferimenti a `itemId`, non a una bozza. Quando viene pubblicata una nuova revisione Item:

- una modifica compatibile genera warning;
- l'assenza della policy ufficiale, del default community o dell'integrita genera errore bloccante;
- in caso bloccante viene creato un repair draft e la visita incompatibile non viene piu servita come pubblicata.

## Dipendenze Layout -> Visit

Quando viene pubblicata una nuova `MuseumLayoutRevision`, il backend controlla tutte le VisitRevision che coinvolgono quel museo.

- placement e raggiungibilita ancora validi: warning, visita pubblicata mantenuta;
- placement mancante o grafo disconnesso per tappe consecutive: errore bloccante, repair draft e rimozione della visita incompatibile dalla pubblicazione.

Il `plannedPath` e una preferenza editoriale e non un vincolo runtime. Il Navigator usa sempre il layout pubblicato corrente: se il planned path e superseded, non continuo o incompatibile con i requirements dell'utente, esegue routing dinamico.

`check-consistency` valida anch'esso contro il layout pubblicato corrente e segnala `STALE_LAYOUT_REVISION` quando una transizione editoriale contiene un riferimento obsoleto.

## Endpoint principali

Item:

```text
POST   /api/museums/:museumId/items
PATCH  /api/museums/:museumId/items/:itemId
POST   /api/museums/:museumId/items/:itemId/check-consistency
POST   /api/museums/:museumId/items/:itemId/request-review
POST   /api/museums/:museumId/items/:itemId/withdraw-review
POST   /api/museums/:museumId/items/:itemId/request-changes
POST   /api/museums/:museumId/items/:itemId/publish
DELETE /api/museums/:museumId/items/:itemId
POST   /api/museums/:museumId/items/:itemId/restore
DELETE /api/museums/:museumId/items/:itemId/hard-delete
```

Visite: endpoint equivalenti sotto `/api/visits/:visitId`.

Layout:

```text
PUT  /api/museums/:museumId/layout
POST /api/museums/:museumId/layout/check-consistency
POST /api/museums/:museumId/layout/request-review
POST /api/museums/:museumId/layout/withdraw-review
POST /api/museums/:museumId/layout/request-changes
POST /api/museums/:museumId/layout/publish
```

Per leggere una revisione di lavoro autorizzata si usa `?view=working`.

## Incompatibilita rispetto al modello precedente

I campi revisionabili non sono piu contenuti direttamente in `Item` e `Visit`. `relationCommands` e stato rimosso e le relazioni logistiche non fanno piu parte del grafo degli Item: orientamento, Place e connection appartengono a `MuseumLayoutRevision`.

La rimozione di una chiave di vocabolario ancora usata da revisioni attive viene bloccata. Riordinamenti e variazioni di `targetSeconds` incrementano `vocabularyRevision` e marcano i contenuti dipendenti per il ricontrollo.
