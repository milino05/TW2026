# ArtAround — Domain Model v2

Questo documento descrive il modello di dominio corrente di ArtAround. Le specifiche ufficiali stabiliscono cosa il prodotto deve fare; il codice della branch di riferimento stabilisce cosa è implementato. In caso di conflitto prevalgono le specifiche.

## 1. Principi

- ArtAround è generico rispetto a musei, gallerie ed esposizioni.
- Semantica, contenuto editoriale/presentazione e presenza fisica sono assi distinti.
- Una Visit non è un array di testi: distingue contenuti, ancore fisiche e logistica.
- Gli Item sono contenuti editoriali; le indicazioni logistiche non sono Item.
- Più Item possono riferirsi allo stesso Subject e possono esprimere approcci, profondità, lingue, durate e metadati differenti.
- Published/released data usati come dipendenza sono revisionati e immutabili.
- Ownership, licenza, offerta, acquisizione/entitlement, adozione, appartenenza a uno Space e appartenenza a una Collection sono concetti distinti.
- Il modello deve restare predisposto a sincronizzazione, QR/geolocalizzazione, routing dinamico, LLM, linguaggio naturale, traduzione e sessioni collaborative senza introdurre workaround nel dominio base.

## 2. Principal e ownership

Le risorse possedibili appartengono a:

```text
User | Organization
```

`Organization` è il principal collaborativo stabile. Una Organization può gestire più Venue, ContentSpace, Collection, Namespace, SemanticGraph, Visit e altre risorse.

L'ownership non concede implicitamente diritti su risorse esterne.

## 3. Subject

`Subject` è l'identità ArtAround-globale e stabile di un'entità o concetto semanticamente indirizzabile.

```text
Subject
  id
  preferredLabel
  description?
  externalIdentities[]?
```

Invarianti:

- la fisicità non è implicita;
- le identità esterne sono opzionali e provider-neutral;
- la coppia `(scheme, id)` identifica al massimo un Subject;
- label simili non producono merge automatici;
- un Subject non viene copiato quando vengono copiati Item, Collection o SemanticGraph;
- più Item e più VenueTarget possono riferirsi allo stesso Subject;
- un Subject può esistere senza Item e senza presenza fisica.

## 4. Namespace e NamespaceRevision

`Namespace` è il contratto semantico-editoriale posseduto da User o Organization e revisionato tramite `NamespaceRevision`.

Le definition namespace-local hanno identità stabile attraverso le revisioni. Le famiglie comprendono almeno:

- SubjectClassDefinition;
- RelationTypeDefinition;
- DurationType;
- LanguageLevel;
- PresentationAspectDefinition;
- SelectionSignalDefinition.

`RelationTypeDefinition.domain/range` referenziano SubjectClassDefinition.

Un Namespace esterno può essere riusato se i diritti lo consentono. Modificarlo richiede una fork indipendente.

## 5. Item, ItemEdition, ItemRevision

`Item` è una lineage editoriale namespace-neutral:

```text
Item
  id
  primarySubjectId
  ownerType
  ownerId
  provenance
  lifecycleStatus
```

`ItemEdition = Item x Namespace`:

```text
ItemEdition
  itemId
  namespaceId
  workingRevisionId?
  publishedRevisionId?
```

Esiste al massimo una lineage ItemEdition per coppia Item+Namespace.

`ItemRevision` contiene il payload editoriale/presentazionale immutabile della Edition, inclusi autore, licenza, provenance della NamespaceRevision e le representation disponibili. Le representation possono differire per durata, LanguageLevel, lingua/locale e altre dimensioni di presentazione.

La `defaultPresentation` è una scelta concreta di Variant/Representation valida come fallback.

La modifica di un Item esterno richiede fork quando la licenza lo permette; l'appartenenza a Space o Collection non trasferisce ownership.

## 6. ContentSpace

`ContentSpace` è l'inventario editoriale di un principal. Non possiede semanticamente gli Item o i Subject che contiene.

Lo Space mantiene due scope espliciti e indipendenti:

```text
ContentSpaceItemMembership
  contentSpaceId
  itemId
  addedBy

ContentSpaceSubjectMembership
  contentSpaceId
  subjectId
  addedBy
```

Un Item può appartenere a più ContentSpace. Un Subject può appartenere a uno Space anche senza alcun Item nello stesso Space.

Invarianti:

- aggiungere un Item owned allo Space materializza anche il suo `primarySubjectId` nello scope Subject dello Space;
- la presenza di un Subject nello Space non crea Item;
- la presenza di un Item/Subject nello Space non concede ownership o diritti commerciali;
- per gli Item posseduti dal principal deve esistere almeno una membership verso un ContentSpace attivo;
- rimuovere uno Space non elimina Item o Subject;
- una membership verso contenuto esterno è valida soltanto se il principal dispone dei diritti necessari.

## 7. Collection / EditorialContext

`EditorialContext` è la Collection editoriale user-facing.

```text
EditorialContext
  contentSpaceId
  namespaceId
  semanticGraphId
  displayName
  descriptions
  workingVersion
  activeReviewRevisionId?
  publishedReleaseId?
```

La Collection riferisce tre risorse distinte:

```text
ContentSpace   -> inventario editoriale disponibile
Namespace      -> regole editoriali/presentazionali
SemanticGraph  -> semantica condivisibile
```

Non esiste l'invariante `EditorialContext = ContentSpace x Namespace` univoco: più Collection possono usare lo stesso Space e lo stesso Namespace, e possono anche condividere lo stesso SemanticGraph.

La Collection mantiene due membership esplicite:

```text
CollectionItemMembership
  editorialContextId
  itemId
  curationSignals[]

CollectionSubjectMembership
  editorialContextId
  subjectId
```

Invarianti:

- l'Item della Collection deve essere presente nello Space della Collection;
- il `primarySubjectId` di ogni Item della Collection deve appartenere anche allo scope Subject della Collection;
- ogni Subject della Collection deve essere nello scope Subject dello Space;
- un Subject può appartenere alla Collection senza avere un Item;
- aggiungere/rimuovere un Item dalla Collection non modifica automaticamente il SemanticGraph;
- aggiungere/rimuovere un Subject dal SemanticGraph non modifica automaticamente la Collection;
- la Collection non possiede il SemanticGraph.

## 8. SemanticGraph

`SemanticGraph` è una lineage autonoma, revisionata e riutilizzabile.

```text
SemanticGraph
  ownerType
  ownerId
  namespaceId
  displayName
  description?
  workingRevisionId?
  workingVersion
  lifecycleStatus
```

Compatibilità di riuso: stesso principal e stesso Namespace.

Un SemanticGraph può essere condiviso da più Collection, anche appartenenti a ContentSpace diversi. Lo Space influenza ranking e coverage nella UI, non l'eligibility del grafo.

Le revisioni contengono nodi e relazioni:

```text
GraphSubjectBinding
  graphRevisionId
  subjectId
  subjectClassDefinitionIds[]

SemanticEdge
  graphRevisionId
  sourceSubjectId
  targetSubjectId
  relationTypeDefinitionId
  weight
  provenance?
```

I nodi sono Subject, non Item.

La membership di un Subject nel SemanticGraph è distinta dalla membership dello stesso Subject in Space e Collection.

Una fork del grafo copia lo snapshot semantico in una nuova lineage, riusando gli stessi Subject e definition IDs compatibili; non copia Item, ItemEdition, membership di Space o membership di Collection.

## 9. Review e EditorialRelease

La review congela lo stato editoriale corrente in `EditorialContextRevision`. La publication produce un `EditorialRelease` immutabile.

Lo snapshot include:

```text
EditorialRelease
  editorialContextId
  sourceContextRevisionId
  namespaceRevisionId
  graphRevisionId
  subjectIds[]
  itemBindings[]
    itemId
    itemEditionId
    itemRevisionId
    curationSignals[]
```

`subjectIds` è il perimetro semantico della Collection al momento della review/release. Non coincide necessariamente con tutti i Subject presenti nel SemanticGraph.

Invarianti:

- la release include soltanto Item appartenenti alla Collection;
- ogni binding congela Item, Edition e Revision;
- il graph revision pinned può contenere più Subject del perimetro della Collection, ma il runtime usa `subjectIds` per delimitare lo scope esposto;
- nuove revisioni di un SemanticGraph condiviso non modificano review o release già pinzate;
- una release valida richiede coerenza tra NamespaceRevision, GraphRevision, Item bindings e Subject scope;
- released/immutable non significa necessariamente public/discoverable.

## 10. Commerciale, diritti e adozione

Restano distinti:

```text
ownership
license
Offer
Acquisition
Entitlement
Adoption
ContentSpace membership
Collection membership
Generator inclusion
```

L'acquisizione non trasferisce ownership editoriale. I command che collegano contenuti esterni a Space o Collection devono verificare i capability/entitlement backend-side; una membership DB non è una prova sufficiente di autorizzazione.

## 11. Organization, Venue e VenueTarget

`Venue` è il contesto fisico visitabile ed è gestito da una Organization.

`VenueTarget` rappresenta una presenza/esposizione fisica locale di un Subject:

```text
VenueTarget
  venueId
  subjectId
  recognition / physical metadata
```

Il dominio fisico resta separato da Item, ContentSpace, Collection e SemanticGraph.

Le capability fisiche e di navigazione appartengono a VenueTarget/Layout, non agli Item.

## 12. Layout e VenueRelease

Il Layout posiziona `ExhibitSlot`; i binding di `VenueRelease` collegano lo stato fisico pubblicato ai VenueTarget.

Una Visit salva riferimenti stabili alle entità fisiche necessarie, non la logistica come Item.

Una nuova VenueRelease può modificare lo stato fisico senza riscrivere retroattivamente Visit/Session già pinzate.

## 13. EditorialScope e PhysicalScope

Editorial scope e physical scope sono assi indipendenti.

```text
EditorialScope
  EditorialRelease[]
  -> Subject scope + ItemRevision + SemanticGraphRevision

PhysicalScope
  Venue/VenueRelease[]
  -> VenueTarget + Layout + routing
```

La raggiungibilità semantica non crea automaticamente una tappa fisica. La presenza fisica non crea automaticamente contenuto editoriale.

## 14. Visit e VisitRevision

`Visit` è una lineage revisionata posseduta da User o Organization.

`VisitRevision` distingue almeno:

```text
editorialSources[]
contentEntries[]
visitAnchors[]
presentationBaseline?
logistics
```

`contentEntries` congelano i riferimenti editoriali necessari; `visitAnchors` rappresentano le occorrenze fisiche nell'itinerario; la logistica collega le ancore e resta separata dai contenuti.

Più ContentEntry possono condividere la stessa ancora. Un contenuto può essere contestuale e non corrispondere al Subject fisico dell'ancora davanti alla quale viene presentato.

## 15. Runtime e generator

Il generator risolve sorgenti editoriali autorizzate e scope fisici espliciti, quindi congela gli snapshot necessari nel piano generato.

Il runtime non usa il SemanticGraph globale come catalogo illimitato: per ogni EditorialRelease usa il `graphRevisionId` pinzato insieme al relativo `subjectIds` perimetro.

Questo consente domande e approfondimenti semantici senza confondere:

- cosa esiste nel grafo;
- cosa appartiene alla Collection;
- quali contenuti sono disponibili;
- cosa è fisicamente presente nella Venue.

## 16. Regole di evoluzione

Per nuove feature:

1. definire prima l'entità e l'invariante di dominio;
2. non usare adapter per evitare di correggere strutture interne controllate da ArtAround;
3. non reintrodurre membership aggregate generiche: Item e Subject hanno scope distinti;
4. non reintrodurre entry di Collection basate soltanto su ItemEdition: la Collection seleziona Item e la release risolve/pinza la Edition/Revision compatibile;
5. non legare il SemanticGraph a un singolo ContentSpace o a una singola Collection;
6. non usare la presenza nel grafo come prova di appartenenza alla Collection;
7. non usare la membership nello Space come prova di entitlement;
8. preservare snapshot immutabili per review, release, Visit e Session.
