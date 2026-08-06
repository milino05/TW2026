# Revisioni e workflow editoriale

## Separazione tra identita e contenuto

`Item` e `Visit` sono identita stabili. I contenuti modificabili risiedono rispettivamente in `ItemRevision` e `VisitRevision`.

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

Una revisione `in_review` e bloccata e non puo essere modificata. L'operator deve ritirare la richiesta oppure attendere la decisione del manager.

Un manager puo pubblicare direttamente un proprio `draft` integro.

Le visite community non usano la revisione manageriale e seguono:

```text
draft -> published
```

## Consistenza e revisione

L'operator puo modificare e lanciare `check-consistency`. Per inviare una revisione al manager non devono esistere errori bloccanti.

Il manager puo:

- pubblicare;
- richiedere modifiche con motivazione obbligatoria.

Ogni richiesta, ritiro, richiesta di modifiche e pubblicazione viene conservata in `review.events` con attore, data e messaggio, cosi una nuova revisione non cancella la cronologia delle decisioni precedenti.

La pubblicazione sposta il puntatore `publishedRevisionId` sulla nuova revisione, azzera `workingRevisionId` e marca la precedente revisione pubblicata come `superseded`.

## Cestino

Il cestino appartiene all'entita stabile:

```text
lifecycleStatus: active | trashed
```

Un operator puo spostare nel cestino item e visite ufficiali. Un manager puo ripristinare o cancellare definitivamente.

L'hard delete e consentito soltanto dal cestino e viene bloccato quando esistono dipendenze storiche o attive. Non sono previste cancellazioni a cascata.

## Dipendenze delle visite

Le visite mantengono riferimenti a `itemId`, non a una bozza. Durante una modifica continuano quindi a usare la revisione pubblicata corrente.

Quando viene pubblicata una nuova revisione dell'item:

- una semplice modifica compatibile genera un warning e richiede un ricontrollo;
- l'assenza della policy ufficiale, del default community o dell'integrita genera un errore bloccante;
- in caso bloccante la visita non viene piu servita come pubblicata e viene creata una revisione di riparazione.

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

Per leggere una revisione di lavoro autorizzata:

```text
GET ...?view=working
```

## Incompatibilita rispetto al modello precedente

I campi revisionabili non sono piu contenuti direttamente in `Item` e `Visit`. Le integrazioni devono usare la coppia `{ item, revision }` o `{ visit, revision }` restituita dai servizi.

`relationCommands` e stato rimosso: le relazioni si modificano nell'array `relations` della revisione di lavoro. Le relazioni pubbliche e inverse vengono calcolate dalle revisioni pubblicate.

La rimozione di una chiave di vocabolario ancora usata da revisioni attive viene bloccata. Riordinamenti e variazioni di `targetSeconds` incrementano `vocabularyRevision` e marcano i contenuti dipendenti per il ricalcolo.
