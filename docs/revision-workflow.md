# Revisioni e workflow editoriale

## Identita, contenuto e topologia semantica

`Item`, `Visit` e `MuseumLayout` sono identita stabili. I contenuti modificabili risiedono rispettivamente in `ItemRevision`, `VisitRevision` e `MuseumLayoutRevision`.

Per gli Item la topologia del knowledge graph e separata dal payload revisionato:

```text
Item
├── publishedRevisionId
└── workingRevisionId

ItemRevision
└── payload editoriale / presentazione

SemanticEdge
└── sourceItemRevisionId
```

`SemanticEdge` e la fonte autorevole delle relazioni tra Item. `ItemRevision` non contiene `relations[]`.

## Creazione e modifica Item

La creazione produce l'Item stabile e `ItemRevision version: 1` in stato `draft`. Gli eventuali `semanticEdges` del payload vengono persistiti come documenti `SemanticEdge` associati alla nuova revisione.

Quando un operator modifica un Item gia pubblicato e non esiste una working revision, il backend:

1. clona il payload della revisione pubblicata in una nuova ItemRevision draft;
2. clona gli outgoing SemanticEdge della revisione pubblicata assegnandoli alla nuova `sourceItemRevisionId`;
3. imposta `workingRevisionId` sulla nuova revisione.

La revisione pubblicata e il suo edge set restano immutati e continuano a essere serviti al Navigator.

Il payload authoring usa `semanticEdges`. I precedenti `relations` embedded e `relationCommands` vengono rifiutati esplicitamente; non esiste un adapter di conversione.

## Published e working graph

Il pointer dell'Item seleziona simultaneamente nodo e outgoing topology:

```text
published graph
Item.publishedRevisionId = R7
→ payload R7
→ SemanticEdge[sourceItemRevisionId=R7]

working graph
Item.workingRevisionId = R8
→ payload R8
→ SemanticEdge[sourceItemRevisionId=R8]
```

Se un Item non ha working revision, la vista working usa la revisione pubblicata. La working graph non viene cacheata perche e mutabile a pointer invariato; la published graph puo usare una cache runtime non autorevole.

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

Le visite community seguono il workflow previsto per le Visit e non creano workflow separati per gli archi semantici.

## Consistenza e pubblicazione Item

`check-consistency` valida insieme:

- payload dell'ItemRevision;
- PresentationVariant/defaultPresentation;
- semanticRefs e SelectionSignal;
- SemanticEdge della revisione;
- esistenza e stato dei target;
- RelationType;
- domain/range;
- multiplicity e peso degli edge.

Gli archi non hanno un workflow autonomo. Pubblicare l'Item cambia `publishedRevisionId`; quel singolo pointer rende contemporaneamente autorevoli la revisione e gli edge con la corrispondente `sourceItemRevisionId`. La precedente revisione viene marcata `superseded` ma resta uno snapshot storico coerente con il proprio edge set.

## Relazioni inverse e simmetriche

Il database salva un solo SemanticEdge autorevole. Le viste inverse e simmetriche sono materializzate da `relationSemantics.service`/`SemanticGraphService` usando `RelationType`. Non vengono persistiti archi inversi duplicati.

## Baseline temporale della visita

Una `VisitRevision` pubblicata conserva `baselineTiming` calcolata al momento della pubblicazione con la policy algoritmica e i valori editoriali/cold-start previsti per una baseline riproducibile. I profili comportamentali personali non vengono incorporati nello snapshot editoriale.

Item, vocabolari o layout che cambiano successivamente possono generare warning o repair draft, ma non riscrivono la baseline storica della VisitRevision pubblicata. Le stime personalizzate runtime usano invece i modelli correnti.

## Cestino e hard delete

Il cestino appartiene all'entita stabile con `lifecycleStatus: active | trashed`. Un hard delete di Item e bloccato se esistono:

- content entry di Visit che lo referenziano;
- SemanticEdge di altri nodi che lo usano come target;
- semanticFocus che lo referenziano.

Se l'Item puo essere cancellato, vengono eliminati anche i suoi ItemRevision e gli outgoing SemanticEdge. Non vengono effettuate cancellazioni a cascata di fatti appartenenti ad altri Item.

## Dipendenze Item -> Visit

Le visite mantengono riferimenti a `itemId`, non a una bozza. Quando viene pubblicata una nuova ItemRevision:

- una modifica compatibile genera warning;
- l'assenza della policy ufficiale, del default community o dell'integrita genera errore bloccante;
- in caso bloccante viene creato un repair draft e la visita incompatibile non viene piu servita come pubblicata.

## Dipendenze vocabolario -> grafo

La rimozione di un RelationType ancora usato da `SemanticEdge` appartenenti a revisioni attive viene bloccata. Il controllo delle dipendenze non legge piu campi embedded di ItemRevision.

## Dipendenze Layout -> Visit

Quando viene pubblicata una nuova `MuseumLayoutRevision`, il backend controlla le VisitRevision coinvolte. Solo le content entry `target` dipendono dal layout; le entry `context` restano semantiche e non richiedono placement.

Il `plannedPath` e una preferenza editoriale e non un vincolo runtime. Il Navigator usa il layout pubblicato corrente e puo eseguire routing dinamico se il path editoriale non e piu utilizzabile.

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

Le response Item includono `semanticEdges` della revisione selezionata accanto a `item` e `revision`. Per leggere una revisione working autorizzata si usa `?view=working`.

Le viste incoming/outgoing pubbliche usano `SemanticGraphService`; non eseguono piu una scansione delle ItemRevision per ricostruire gli archi inversi.

Visite e Layout mantengono i propri endpoint revisionati gia documentati nelle rispettive specifiche.
