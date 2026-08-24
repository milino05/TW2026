# ArtAround — Domain Model v2

Questo documento e il contratto architetturale canonico per il refactoring `main -> v2`.

Le specifiche ufficiali stabiliscono cosa ArtAround deve fare; questo modello stabilisce come il dominio interno lo rappresenta. Il codice legacy ancora presente durante il refactoring non modifica questo contratto. Le formulazioni precedenti incompatibili sono superseded.

## 1. Principi

- ArtAround e generico rispetto a musei, gallerie ed esposizioni.
- Il dominio editoriale, il dominio semantico e il dominio fisico sono separati e cooperano tramite identita stabili.
- Una Visit non e un array di testi: distingue sequenza narrativa, riferimenti fisici e logistica.
- Gli Item sono contenuti editoriali; le indicazioni logistiche non sono Item.
- Piu contenuti possono riferirsi allo stesso soggetto culturale e possono avere differenti approcci editoriali, profondita, linguaggi, lunghezze e metadati.
- Published/released data usati come dipendenza sono revisionati e immutabili; le nuove revisioni non riscrivono retroattivamente Visit o Session gia materializzate.
- Ownership, licenza, offerta commerciale, acquisizione/entitlement, adozione e inclusione nel generator sono concetti distinti.
- Il modello base non implementa prematuramente 18–27/18–33, ma non deve richiedere workaround per sincronizzazione, sessioni docente/studenti, quiz, QR/geolocalizzazione, routing dinamico, LLM, linguaggio naturale e traduzione.

## 2. Principal e ownership

Le risorse editoriali possedibili possono appartenere a:

```text
User | Organization
```

`Organization` e il principal collaborativo stabile. Una Organization puo gestire piu Venue, ContentSpace e altre risorse.

L'ownership di una risorsa non implica automaticamente licenze su risorse esterne, entitlement commerciali o authority fisica su una Venue.

## 3. Subject

`Subject` e l'identita ArtAround-globale e stabile di una entita o concetto culturalmente/semanticamente indirizzabile.

```text
Subject
  id
  preferredLabel
  description?
  externalIdentities[]?
```

Ogni `externalIdentity` rappresenta esclusivamente identità esatta e contiene almeno `scheme`, `id`, ruolo `canonical | historical`, provenance della conferma ArtAround e stato della verifica provider. Un identificatore storico dichiara il `canonicalId` corrente senza essere presentato come binding corrente equivalente.

Invarianti:

- la fisicita non e implicita;
- le identità esterne sono opzionali e provider-neutral;
- esiste al massimo una identity canonica corrente per scheme nello stesso Subject;
- la coppia `(scheme, id)` identifica al massimo un Subject nell'intero database, inclusi gli ID storici;
- `Subject.externalIdentities` ammette soltanto identità esatta: `close`, `broader` e `narrower` restano mapping di vocabolario nelle `semanticRefs` di Namespace e PlaceType;
- Candidate esterna, mapping di vocabolario e binding confermato sono concetti distinti;
- redirect e canonicalizzazione non autorizzano modifiche silenziose ai binding esistenti;
- i label non vengono usati per merge fuzzy;
- un Subject non viene copiato/forkato quando vengono copiati contenuti o grafi;
- piu Item e piu VenueTarget possono riferirsi allo stesso Subject.

## 4. Namespace e NamespaceRevision

`Namespace` e un vocabolario/contratto semantico-editoriale posseduto da User o Organization e revisionato tramite `NamespaceRevision`.

Le definition namespace-local hanno identita interna stabile attraverso le revisioni. Una modifica di key/label non cambia l'identita; un cambiamento di significato semantico richiede una nuova definition identity.

Famiglie previste includono almeno:

- SubjectClassDefinition;
- RelationTypeDefinition;
- DurationType;
- LanguageLevel;
- PresentationAspectDefinition;
- SelectionSignalDefinition.

`RelationTypeDefinition.domain/range` referenziano SubjectClassDefinition, non ItemType.

Una revisione di contenuto o graph puo essere riutilizzata sotto una NamespaceRevision successiva della stessa lineage dopo revalidation; non serve clonarla automaticamente a ogni revisione del Namespace.

Un Namespace esterno puo essere riusato se i diritti lo permettono. Modificarlo richiede una fork in una lineage indipendente.

## 5. Item, ItemEdition, ItemRevision

`Item` e una lineage editoriale namespace-neutral:

```text
Item
  id
  primarySubjectId
  owner
  provenance
  lifecycle
```

`ItemEdition = Item x Namespace`:

```text
ItemEdition
  itemId
  namespaceId
  publishedRevisionId?
  workingRevisionId?
```

Esiste al massimo una ItemEdition lineage per coppia Item+Namespace.

`ItemRevision` contiene il payload editoriale/presentazionale immutabile di una Edition, con autore/licenza e provenance di NamespaceRevision. Le representation possono differire per durata, LanguageLevel, lingua/locale e altre dimensioni di presentation.

Una ItemRevision definisce una `defaultPresentation` concreta e valida da usare quando non esistono abbastanza dati espliciti o appresi per scegliere una representation migliore.

Gli stessi Item possono avere Edition differenti in Namespace differenti (per esempio Academic e Comedy) senza diventare contributi editoriali indipendenti. Se il contributo editoriale diverge realmente, si crea/forka un nuovo Item mantenendo il medesimo Subject quando appropriato.

Un autore terzo non modifica una Item lineage altrui: se vuole adattare il contenuto e la licenza lo consente, effettua fork dell'Item e conserva provenance e primarySubjectId.

La terminologia interna `Item` non deve essere deformata soltanto per coincidere letteralmente con la terminologia della specifica. I dati richiesti dalla specifica — testo presentabile/TTS, lunghezza, linguaggio, autore, licenza e associazione non ambigua al soggetto — devono pero esistere ed essere esposti chiaramente dalle API/UI appropriate.

## 6. ContentSpace e ContentSpaceMembership

`ContentSpace` e un workspace/collection editoriale curato da User o Organization.

Non e una cartella filesystem e non possiede semanticamente gli Item che contiene.

```text
ContentSpaceMembership
  contentSpaceId
  itemId
  addedBy
  metadata?
```

Un Item puo appartenere contemporaneamente a piu ContentSpace.

Operazioni distinte:

- Add/link: aggiunge una membership allo stesso Item;
- Move: rimuove una membership e ne aggiunge un'altra, senza cambiare Item/Subject/Editions;
- Fork: crea una nuova Item lineage.

La membership non concede ownership, diritto di modifica, resale o derivative rights.

User e Organization possono possedere piu ContentSpace personali/organizzativi. Non introduciamo una gerarchia di ContentSpace finche non emerge un requisito reale.

## 7. EditorialContext

`EditorialContext = ContentSpace x Namespace` ed e unico per la coppia.

E un contesto editoriale comprensibile anche all'utente, non soltanto un join tecnico. Deve avere metadata user-facing curati, almeno nome e descrizione, mentre statistiche e stato operativo sono proiezioni derivate.

Lo stesso ContentSpace puo avere contemporaneamente piu EditorialContext (es. Academic, Kids, Comedy). Un Item nel ContentSpace non e obbligato ad avere Edition per tutti i Namespace usati dal ContentSpace.

EditorialContext e Venue-independent: non contiene `venueId` e lo stesso Context puo essere usato con piu Venue.

## 8. SemanticGraph

Il graph semantico appartiene a un EditorialContext ed e revisionato tramite GraphRevision immutabili.

I nodi sono Subject, non Item.

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
  metadata/provenance?
```

Non esiste un assertion graph globale autorevole. Le asserzioni sono locali/provenanced nel relativo EditorialContext.

La classificazione di uno stesso Subject puo differire fra Context differenti.

La copia di un graph nello stesso Namespace puo riusare Subject IDs e definition IDs, mantenendo provenance. Fra Namespace diversi serve mapping esplicito delle definition; non si inferisce equivalenza dai label.

## 9. EditorialRelease

`EditorialRelease` e lo snapshot coerente e immutabile pubblicato/rilasciato di un EditorialContext:

```text
EditorialRelease
  editorialContextId
  namespaceRevisionId
  graphRevisionId
  itemBindings[]
    itemEditionId
    itemRevisionId
```

Una release puo includere soltanto un sottoinsieme degli Item del ContentSpace.

La release viene validata come un insieme coerente: appartenenza delle Edition al Namespace, revisioni corrette, definition identity risolvibili, graph compatibile e default presentation valida.

Released/immutable non significa necessariamente public/discoverable. Questa distinzione e necessaria per contenuti privati 18–27.

## 10. Commerciale e adozione

La granularita primaria del contenuto commercializzabile e `ItemEdition`. `ItemRevision` conserva snapshot di autore/licenza della versione consumata.

Sono separati:

```text
ownership
license
Offer/price
Acquisition/Purchase
Entitlement
Adoption
Generator inclusion
```

Una singola adozione di contenuto normalmente punta a ItemEdition; bundle/adoption possono puntare a EditorialContext/EditorialRelease. L'adozione e endorsement/curation e non trasferisce ownership ne include automaticamente un contenuto nel generator.

I diritti di utilizzo di un Namespace sono separati dai diritti sui contenuti.

## 11. Organization, Venue, VenueTarget

`Venue` e il contesto fisico visitabile ed e gestito da una Organization.

`VenueTarget` e una occorrenza fisicamente visitabile locale associata a un Subject.

```text
VenueTarget
  venueId
  subjectId
  physical capabilities / recognition data
```

Non esiste unicita `(venueId, subjectId)`: la stessa entita/concezione puo avere piu occorrenze fisiche nella stessa Venue quando il dominio lo richiede.

Le capability fisiche e di navigazione appartengono a VenueTarget/Layout, non a ItemType.

Published Venue infrastructure e referenziabile read-only anche da autori di Visit che non possiedono la Venue. L'ownership della Venue governa le modifiche fisiche, non il diritto di costruire una Visit che la usa.

`Venue.primaryEditorialContextId?` e un default/endorsement autorevole della Venue, non ownership/esclusivita e non un vincolo sulle Visit esterne.

## 12. Layout e VenueRelease

Il Layout posiziona VenueTarget, non Item.

`VenueRelease` rappresenta lo stato fisico pubblicato coerente della Venue e punta a revisioni/layout immutabili pertinenti.

Una Visit salva stable VenueTarget refs, non coordinate, Place, path o una LayoutRevision permanente.

All'avvio di una nuova Session vengono risolte le current published VenueRelease e poi pinned per la durata della Session.

Una nuova VenueRelease puo spostare un VenueTarget senza modificare la Visit. La rimozione/indisponibilita di un target causa audit/revalidation delle Visit dipendenti; non riscrittura silenziosa.

In futuro `VenueRuntimeState` puo modellare chiusure/ostacoli temporanei senza modificare il modello base.

## 13. EditorialScope e PhysicalScope

Editorial scope e physical scope sono assi indipendenti.

```text
EditorialScope
  EditorialRelease[]
  -> ItemEdition, ItemRevision, SemanticGraph

PhysicalScope
  Venue/VenueRelease[]
  -> VenueTarget, layout, routing
```

Un graph non viene filtrato semanticamente in base alla Venue. Un Subject raggiungibile nel graph puo produrre contenuto contestuale anche se non ha un target nella Venue corrente.

Le candidate fisiche provengono esclusivamente dai VenueTarget utilizzabili delle Venue esplicitamente nel PhysicalScope. La raggiungibilita semantica non crea una tappa fisica.

Non esiste un `PhysicalAvailabilityResolver` obbligatorio nel Domain Model: questa e una query/capability implementativa e potra essere estratta in futuro soltanto se la logica runtime lo giustifica.

Multi-Venue e sempre esplicito. Un collegamento semantico verso un Subject presente altrove non aggiunge automaticamente una Venue o un trasferimento all'itinerario.

## 14. Visit e VisitRevision

`Visit` e una lineage revisionata e posseduta da User o Organization.

La visibility/discoverability pubblica della Visit e un concern separato e non viene ridefinita in questo documento.

`VisitRevision` distingue:

```text
VisitRevision
  editorialSources[]
    editorialReleaseId

  contentEntries[]        # ordine narrativo canonico
    itemId
    itemEditionId
    itemRevisionId
    editorialSourceId
    role
    deliveryAnchorId?

  visitAnchors[]          # ordine fisico
    id
    venueTargetId

  presentationBaseline?
  logistics
    preVisitNotes[]
    routeHints[]
      fromAnchorId
      toAnchorId
      ...
```

Questa e la decisione `51R`: Content itinerary + physical anchors.

`VisitAnchor` e una occorrenza fisica nell'itinerario, non un Item e non un contenitore canonico dei contenuti. Piu ContentEntry possono condividere lo stesso Anchor; una ContentEntry puo non avere Anchor; lo stesso VenueTarget puo comparire in due Anchor distinti in momenti diversi.

Il Subject della ContentEntry puo essere diverso dal Subject del VenueTarget dell'Anchor: un contenuto su un artista/stile puo essere fruito davanti a un'opera senza diventare una nuova tappa.

La logistica collega Anchor, non testi. Le indicazioni logistiche restano separate dagli Item.

## 15. Visit copy e fork

Una copia e detached:

- crea una nuova Visit identity e una nuova VisitRevision iniziale;
- conserva provenance `copiedFromVisitId/copiedFromVisitRevisionId`;
- non riceve automaticamente modifiche future dalla Visit sorgente.

La copia usa structural sharing di dipendenze immutabili: puo continuare a puntare alle stesse EditorialRelease, ItemEdition e ItemRevision senza duplicarle fisicamente.

Le modifiche alla struttura della copia (titolo, ordine, aggiunta/rimozione entry, role, anchor assignment, logistica) modificano soltanto la sua Visit lineage.

La modifica editoriale di un Item esterno richiede fork di quell'Item; la modifica di graph/curation esterni richiede un contesto controllato dall'autore.

Qualunque futura relazione live/upstream non e una `copy`: sara un concetto distinto (template/linked/managed visit o equivalente) con policy esplicita.

L'indipendenza della copia non congela l'infrastruttura fisica o i diritti esterni: nuove Session risolvono la VenueRelease corrente e possono fallire se un target o diritto non e piu disponibile.

## 16. Generator

Il generator accetta uno o piu EditorialContext come source scope.

Se `editorialContextIds` sono espliciti, usa esattamente quelli e non inietta silently context di default. Se non sono espliciti, puo usare `Venue.primaryEditorialContextId` delle Venue selezionate.

Per ogni Context risolve la current released EditorialRelease e ne snapshotta l'ID nel piano generato. Per ogni Venue risolve e snapshotta la VenueRelease rilevante.

La candidate editoriale e una ItemEdition/ItemRevision/Representation. Default: al massimo una Edition per la stessa Item lineage, salvo futuro intento comparativo esplicito.

Se la stessa identica ItemEdition/Revision proviene da piu Context selezionati viene materializzata come una candidate con provenance multipla, non duplicata. Revisioni differenti della stessa Edition restano versioned candidates da gestire tramite ranking/policy.

Le candidate fisiche provengono dal PhysicalScope; il graph serve a valutarne coerenza semantica e a trovare contenuti contestuali, non a creare destinazioni.

## 17. Presentation, DurationType e LanguageLevel

`EditorialContext` descrive un approccio/editorial worldview complessivo (Academic, Kids, Comedy, ecc.).

`DurationType` e `LanguageLevel` descrivono invece varianti di presentazione all'interno di quella stessa Edition/Context. Non sono sostituti dell'EditorialContext e non devono essere usati per modellare differenze editoriali sostanziali.

La representation viene selezionata usando, in ordine concettuale:

1. richiesta esplicita runtime dell'utente;
2. preferenze esplicite pre-visita;
3. learning affidabile;
4. baseline della Visit/GeneratedPlan;
5. `defaultPresentation` della ItemRevision.

Quindi deve sempre esistere un fallback deterministico anche senza dati utente sufficienti.

## 18. Learning

Lo stato adattivo viene separato per scope:

```text
UserSubjectAffinity       # globale
UserSubjectKnowledge      # globale
UserItemEditionAffinity   # contenuto editoriale esatto
UserContentExposure       # ItemEdition + Variant + Representation
UserNamespaceFeatureAffinity
VenueTargetObservation
```

La conoscenza/affinita del Subject e globale. La preferenza per un contributo editoriale esatto e ItemEdition-scoped. Le feature definite da Namespace sono trasferibili fra ContentSpace che condividono lo stesso Namespace.

Namespace differenti interoperano soltanto tramite semanticRefs/mapping espliciti, mai tramite label.

## 19. Session

Una Session materializza una specifica VisitRevision o GeneratedVisitPlan e ne conserva le dipendenze editoriali esatte.

All'avvio:

- verifica accesso/entitlement necessari;
- usa le versioni editoriali pinned dalla Visit/piano;
- risolve le VenueRelease correnti per i VenueTarget del piano;
- pinna tali VenueRelease per la Session;
- calcola/ricalcola il routing fisico rispetto a quelle release.

Durante la Session una richiesta semantica contestuale puo mostrare una diversa representation o un contenuto correlato nello stesso Anchor senza aggiungere automaticamente una tappa fisica.

## 20. 18–27 e 18–33

Il modello consente senza workaround:

- release editoriali immutabili ma non pubblicamente discoverable per contenuti privati docente;
- grant/session access specifici senza aprire l'intero ContentSpace;
- sessioni sincronizzate e controllo teacher/student sopra lo stesso Visit/Session model;
- quiz come concern separato dalla struttura Item/logistica;
- QR/geolocalizzazione risolti su VenueTarget;
- LLM che crea una nuova ItemEdition nello stesso Item/Subject quando serve una nuova espressione sotto un Namespace, oppure un nuovo Item quando crea un contributo editoriale distinto;
- mapping NL verso action disponibili;
- traduzione/nuove representation senza cambiare Subject, VenueTarget o VisitAnchor;
- generazione dinamica su EditorialScope + PhysicalScope.

## 21. Invarianti di refactoring

Il v2 finale non deve contenere queste strutture legacy:

```text
Item.museumId
Item.itemType come capability fisica
Item.publishedRevisionId / workingRevisionId
SemanticEdge.sourceItemId
SemanticEdge.sourceItemRevisionId
SemanticEdge.targetItemId
SemanticEdge.relationTypeKey come identita
Layout.itemPlacements
Visit.kind official|community come ownership model
Visit.ownerMuseumId
VisitRevision.museumIds come source of truth
ContentEntry.spatialMode
routeHints legati alle ContentEntry
EditorialContext.venueId
```

Durante il refactoring possono esistere temporaneamente accanto alle nuove strutture soltanto finche i consumer legacy non sono migrati. Non sono API v2 e non devono generare adapter permanenti.

## 22. Stato di implementazione

Questo file descrive il target definitivo. Il branch `main` al momento dell'introduzione del v2 e ancora museum-centric: usa MuseumVocabulary, Item come nodo del graph e target del layout, e Visit official/community. Il piano di refactoring migra questi boundary in vertical slice mantenendo CI e backend eseguibili a ogni passaggio.
