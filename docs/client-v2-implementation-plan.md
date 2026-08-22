# ArtAround — Piano di implementazione client-v2

Questo documento traduce l’audit architetturale approvato in `docs/client-architecture-decisions.md` in una sequenza di vertical slice implementabili. Non introduce un nuovo modello di dominio e non riapre le decisioni 1–30.

## Obiettivo di consegna

Portare `main` dallo stato attuale, principalmente backend/domain-v2, a un prodotto 18–24 realmente eseguibile con:

- Navigator Vue/Vite/TypeScript, Vue Router e Pinia;
- Marketplace/Editor vanilla JavaScript, ES Modules e Web Components;
- backend Node/Express condiviso;
- Marketplace capability-based;
- Visit Library/Detail/Preparation/Session;
- mappa, logistica, TTS, vocabolario controllato e bottoni equivalenti;
- authoring e catalogo Marketplace;
- generazione strutturata;
- dataset completo d’esame e deploy verificato.

Le capability 18–27/18–33 restano predisposte ma non vengono implementate anticipatamente salvo decisione esplicita.

# Regole di implementazione

1. Ogni slice deve attraversare tutti i layer necessari: dominio già approvato, persistence, service/application boundary, API/projection e client.
2. Le projection user-facing sono contratti separati dai documenti Mongo e dai write model.
3. Nessun client ricostruisce authorization, routing, timing, semantic graph o version resolution.
4. Ogni nuovo endpoint applicativo deve avere test di servizio/API e almeno un consumer client reale nello stesso slice o in quello immediatamente successivo.
5. Le policy temporanee pre-Marketplace vengono rimosse nello stesso slice che introduce il loro sostituto capability-based; non si mantengono due authority model permanenti.
6. Le decisioni 18–27/18–33 vengono rispettate come constraint di design, non come backlog implicito del livello base.
7. I checker legacy e la CI vengono aggiornati progressivamente per impedire regressioni verso i contratti superseded.

# Slice 0 — Repository e client scaffold

## Scopo

Rendere i due client componenti reali del repository e della CI senza introdurre business logic prematura.

## Backend/repository

- definire una struttura top-level esplicita per backend e client senza rompere il deploy corrente; nel primo incremento è accettabile mantenere il backend alla root e aggiungere directory client dedicate;
- rimuovere script npm morti e riferimenti documentali manifestamente legacy;
- aggiornare `checkLegacyContracts.js` per i path correnti;
- preparare script root per build/check dei client.

## Navigator

Creare lo scaffold Vue/Vite/TypeScript con:

- Vue Router;
- Pinia;
- layer `domain/application/capabilities/infrastructure/ui`;
- route shell iniziali: login/home, library, visit detail, session;
- `NavigatorStaticConfig` con `schemaVersion`, `venueId`, branding;
- adapter HTTP con cookie credentials, senza God `ApiService`.

## Marketplace/Editor

Creare client vanilla JS con:

- ES Modules;
- Web Components;
- router minimale client-side;
- application/repository layer separato dal DOM;
- shell Catalog e Workspace ancora vuoti ma navigabili.

## Done

- entrambi i client buildano;
- il backend continua a passare i test correnti;
- CI valida backend + build/check dei due client;
- nessuna business policy introdotta nei componenti UI.

# Slice 1 — Capability core + primo flusso end-to-end

## Scopo

Ottenere il primo percorso reale:

`login -> Marketplace Catalog -> acquisizione gratuita/accesso -> Navigator Library -> Visit Detail -> preparation -> Session -> NEXT/PREVIOUS`.

## Marketplace domain

Implementare il minimo capability core necessario al percorso:

- `MarketplaceListing`;
- `MarketplaceOffer`;
- `MarketplaceAcquisition`;
- `Entitlement`;
- capability registry con almeno `visit.execute`;
- `CapabilityAuthorizationService`;
- acquisition gratuita comunque registrata come Acquisition;
- effective rights resolution per User/Organization principal.

`Adoption` può essere modellata nello stesso bounded context ma non necessita ancora di una UI completa in questo slice.

## Authorization migration

Sostituire per l’esecuzione Visit:

- owner authority;
- Organization principal authority;
- Entitlement `visit.execute`;

senza trattare la membership come entitlement commerciale.

Eliminare dal path di execution la policy owner/membership-only temporanea.

## Marketplace client

Implementare:

- Venue selector iniziale minimale;
- Catalog projection paginata focalizzata sulle Visit;
- card/detail Listing+Offer;
- acquisizione gratuita;
- stato user-facing “già utilizzabile”.

## Navigator client

Implementare:

- login/session bootstrap;
- configured Venue bootstrap;
- Library projection;
- Visit Detail projection minimale;
- avvio del flusso preparation/session;
- Session shell con presentation corrente e bottoni NEXT/PREVIOUS.

## Done

- un utente senza diritto non vede la Visit nella Library personale;
- dopo free acquisition ottiene `visit.execute` e la Library la include quando applicabile alla configured Venue;
- owner authority funziona senza Acquisition fittizia;
- Organization authority non popola automaticamente la Library personale;
- NEXT/PREVIOUS sono operazioni runtime backend-authoritative;
- test E2E minimo copre il percorso completo.

# Slice 2 — Execution source, Preparation e projections Navigator

## Scopo

Sostituire definitivamente lo start `visitId + preferences` con il boundary approvato.

## Backend

Implementare:

- `ResolvedVisitExecutionSource` live/pinned;
- version policy `follow_current | pinned` per `visit.execute`;
- `ExecutionPreparation` transitoria con TTL;
- optimistic concurrency `preparationId + version`;
- effective presentation/navigation preference;
- expected physical snapshot per Venue;
- `preparedPlanCandidate`;
- readiness blocker/warning;
- start idempotente preparation-centric;
- `PREPARATION_PHYSICAL_STATE_CHANGED`.

## Projection

Completare:

- Navigator Visit Library;
- Navigator Visit Detail;
- `preVisit` con provenance separata;
- `LogisticsPreview` dalla stessa computation del SessionPlan;
- session discovery/resume minimale.

## Cleanup

Rimuovere dal percorso Navigator:

- `visitId -> latest published revision` implicito;
- start che rilegge default correnti;
- response con documenti VisitRevision/raw physical internals.

## Done

- una preparation non cambia revision se nel frattempo viene pubblicata una nuova VisitRevision;
- un cambio di VenueRelease rende la preparation stale e blocca lo start;
- start valido persiste il candidate già preparato senza ricalcolo divergente;
- Library e Detail usano la stessa execution-source resolution.

# Slice 3 — Action protocol v2 e runtime cleanup

## Scopo

Unificare bottoni, voce controllata e futuro natural-language adapter sullo stesso protocollo.

## Backend

Implementare:

- `ActionDefinition`/registry platform-level per le famiglie generiche;
- `AvailableAction` materializzate server-side;
- `ActionRequest` con optimistic runtime version dove utile;
- `ActionDispatcher`;
- `ActionResult`/runtime update;
- endpoint runtime Action unico;
- `InteractionEvent` generico con actor, action, channel, context, result, timestamp.

## Presentation

Rinominare semanticamente l’asse corrente:

- depth;
- language complexity;
- locale/translation separata e non ancora implementata nel livello base.

Eliminare `PRESENTATION_LANGUAGE_*` come semantica pubblica della complexity.

## Navigation actions

Materializzare server-side le destination request risolvibili; rimuovere dal contratto Navigator la costruzione di:

- `fromPlaceId`;
- raw Place ID;
- raw routing intent tecnico;
- connection ID.

## Semantic exploration

Derivare le azioni di approfondimento da Item/Subject/SemanticGraph pinned senza catalogo globale obbligatorio `author/style/...`.

## Navigator

- `runtimeStore` applica snapshot/update versionati;
- i componenti renderizzano `AvailableAction`;
- bottoni equivalenti usano `actionId`;
- nessun branch UI per policy studente/docente futura.

## Done

- NEXT/PREVIOUS e presentation adjustment passano dal dispatcher;
- azione non più disponibile produce `ACTION_NOT_AVAILABLE`;
- InteractionEvent è sufficiente per futuro monitoring 18–27;
- nessun endpoint specifico è necessario al client per le normali Action runtime.

# Slice 4 — Navigation, MapProjection, TTS e controlled voice

## Scopo

Completare il nucleo obbligatorio Navigator 18–24.

## Backend navigation

Implementare:

- `NavigationPreparationResolver`;
- canonical global routing requirements;
- mapping per LayoutRevision;
- blocker/warning multi-Venue;
- `NavigationOriginResolver`;
- `NavigationProjection` typed destination;
- `MapProjection` con floor, asset, normalized coordinates, stop/facility projection e route overlay.

## Navigator

Implementare:

- mappa per floor;
- highlight della tappa logica senza marker automatico “you are here”;
- destination/route instructions;
- TTS che legge esattamente `currentPresentation.text`;
- adapter controlled voice che risolve soltanto `AvailableAction` correnti;
- bottoni accessibili equivalenti per tutti i comandi obbligatori disponibili.

## Done

- nessun LayoutRevision/path/connection grezzo arriva al Navigator;
- TTS e testo coincidono;
- i comandi vocali controllati e i bottoni inviano lo stesso ActionRequest;
- toilette/uscita/bar/shop e obstacle query usano semanticamente action differenti;
- il livello 18–24 non afferma una localizzazione fisica automatica inesistente.

# Slice 5 — Marketplace Catalog e Creator Workspace

## Scopo

Portare il Marketplace da Catalog Visit minimo a Marketplace+Editor conforme.

## Backend commercial/application

Completare:

- capability matrix per ItemEdition/Revision, EditorialContext/Release, Namespace/Revision, Visit/Revision;
- Offer integrity/external requirements;
- Catalog search/pagination;
- Asset Detail projection;
- Creator Workspace principal-scoped;
- effective operation projection;
- acquisition history;
- Distribution dashboard;
- `Adoption` e relative registrazioni.

## Creator operations

Migrare gli authorization boundary temporanei per:

- `content.use_in_editorial_release`;
- `content.fork`;
- `namespace.author`;
- `namespace.fork`;
- `context.generate`;
- `context.compose_visit`;
- `context.use_as_venue_primary`;
- `context.import_snapshot`;
- `visit.copy_detached`.

## Marketplace client

Implementare:

- Catalog multi-asset;
- Offer selection/acquisition;
- Workspace User/Organization;
- resource editor routing;
- sales/adoption dashboard;
- availableOperations backend-authoritative.

## Done

- Catalog e Workspace non usano raw aggregate list come read model;
- ownership e capability esterne sono visivamente distinguibili;
- reference/import/copy/fork producono gli effetti definiti al Punto 27;
- Acquisition non crea Adoption automaticamente.

# Slice 6 — Item authoring e Venue catalog relevance

## Scopo

Completare l’Editor dei contenuti e il filtro “museo” previsto dalla specifica.

## Backend

Implementare:

- `ItemAuthoringProjection`;
- Subject search/create con exact external refs;
- integrity dei Subject referenziati da relatedSubject/semantic focus/knowledge requirements;
- Venue selector projection Organization -> Venues;
- `VenueCatalogRelevanceResolver`;
- Catalog filtering `selectedVenueIds[]` con semantica union/OR;
- PhysicalScope Visit derivato dagli Anchor;
- relevance editoriale senza `museumId` o ownership-by-Venue.

## Marketplace client

Implementare:

- wizard Subject -> Item -> Edition -> Revision;
- entry point “crea contenuto per questo oggetto” che precompila il Subject senza fondere VenueTarget e Item;
- editor Representation user-facing per durata/complessità/locale/testo;
- ContentSpace membership;
- Context release composition;
- Venue selector multiplo raggruppato per Organization.

## Done

- contenuti su Subject non fisici sono creabili senza Venue;
- più Item possono parlare dello stesso Subject;
- recognition media e illustrative media restano distinti;
- selezionare/deselezionare Venue non modifica automaticamente Visit o asset editoriali.

# Slice 7 — Generator v2 UX + GeneratedPlan materialization

## Scopo

Esporre il generator attuale tramite contratti client-v2 corretti e chiudere il ciclo “genera -> esegui o salva”.

## Backend

Implementare:

- `GenerationOptionsProjection` authorization/scope-aware;
- typed editorial source refs: live Context o pinned EditorialRelease;
- source resolution/version policy;
- default primary Context solo se autorizzato;
- user-facing mapping di semantic goals, presentation e navigation controls;
- materializzazione idempotente `GeneratedPlan -> user-owned Visit`;
- preservation degli snapshot editoriali;
- esclusione di Representation/path/Layout/timing runtime dalla Visit;
- durable inter-Venue RouteHint dove necessario;
- provenance GeneratedPlan -> Visit.

## Navigator

Implementare:

- form generazione;
- selezione Venue fisiche;
- selezione ContentSpace/Context editoriali indipendente;
- GeneratedPlan preview;
- accept;
- direct start;
- “salva nelle mie visite”.

## Done

- explicit source significa esattamente source selezionate;
- il generator non usa `primaryEditorialContextId` come authorization;
- un piano salvato appare come normale Visit personale eseguibile;
- future NL generation può riusare la stessa structured request.

# Slice 8 — Workflow editoriali e hardening commerciale

## Scopo

Chiudere i gap workflow e rendere coerenti gli editor per User/Organization.

## Backend

- separare publication da managerial review;
- Visit user-owned: publish diretto dopo integrity, senza review fittizia;
- Visit organization-owned: `draft -> in_review -> published`, manager-only publish;
- eliminare bypass `draft -> published` organizzativo;
- availableOperations projection per editor;
- applicare la stessa distinzione semantica agli altri aggregate dove il workflow condiviso lo richiede.

## Marketplace client

- UI review/publish basata su availableOperations;
- nessun branch authorization hardcoded su ownerType/role;
- publication editoriale distinta da Listing commerciale.

## Done

- test coprono user-owned e organization-owned workflow;
- nessuna publication personale produce `review.decision=approved` artificiale;
- un manager non può saltare `in_review` per una Visit Organization.

# Slice 9 — Dataset d’esame, compliance e deploy

## Scopo

Trasformare il prodotto tecnicamente completo in una consegna verificabile.

## Seed

Creare un seed completo e ripetibile con:

- i quattro account obbligatori;
- Organization e una Venue demo reale principale;
- LayoutRevision/VenueRelease/mappa/facility/routing;
- almeno dieci opere/target fisici;
- Subject con external reference quando disponibili;
- Namespace completo;
- più Item/Representation per le opere;
- almeno tre Visit pubblicate, ciascuna con >=10 opere, interamente sulla stessa Venue demo;
- Listing/Offer gratuiti/a pagamento simulato sufficienti a mostrare il Marketplace;
- eventuali dati extra cross-museum/multi-Venue non usati per soddisfare il requisito minimo.

## Compliance 18–24

Verificare end-to-end:

- selezione Venue/config Navigator;
- accesso al Marketplace;
- catalogo e adozione/acquisizione;
- selezione ed esecuzione Visit;
- mappa oggetti/facility;
- TTS testo corrente;
- controlled voice + bottoni equivalenti;
- comandi obbligatori significativi nel dataset demo;
- nessuna localizzazione automatica richiesta nel livello base.

## Repository/deploy

- riscrivere README in coerenza con Domain v2 e client reali;
- eliminare/riscrivere documenti legacy, in particolare revision workflow incompatibile;
- rimuovere script npm morti;
- estendere checker legacy/hygiene;
- CI completa backend + client;
- test E2E;
- verifica Docker locale;
- verifica procedura gocker/dipartimento;
- preparazione degli artifact richiesti dalla consegna.

## Done

- clone pulito -> install/build/test/seed -> prodotto demo funzionante;
- requisito dataset verificabile automaticamente;
- nessun documento operativo descrive `museumId`, official/community o altri contratti superseded come architettura corrente;
- deploy del dipartimento riproducibile.

# Ordine e dipendenze

Ordine raccomandato:

`Slice 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9`

Vincoli:

- Slice 2 dipende dal capability access minimo di Slice 1;
- Slice 3 dipende dalla Session/preparation stabile di Slice 2;
- Slice 4 dipende dal protocollo Action per evitare una seconda integrazione voce/bottoni;
- Slice 5 può iniziare in parallelo dopo il capability core di Slice 1, ma non deve reimplementare authorization;
- Slice 7 dipende dalle capability `context.generate` consolidate nel Slice 5;
- Slice 9 deve iniziare presto come seed incrementale, ma viene dichiarato completo soltanto dopo i flussi precedenti.

# Strategia di commit

Ogni slice deve essere scomposto in commit verticali e reversibili, ad esempio:

1. domain/application boundary + test;
2. API/projection + test;
3. client repository/store/application integration;
4. UI;
5. E2E/cleanup/checker/documentation.

Evitare commit che introducono contemporaneamente refactoring non correlati.

# Primo incremento operativo

Il prossimo intervento parte dal **Slice 0** e deve concludersi con:

- Navigator reale buildabile;
- Marketplace reale buildabile;
- CI aggiornata;
- backend invariato funzionalmente;
- struttura pronta per il primo vertical slice capability/access.

Non si implementano ancora Catalog, Session o authoring nel solo scaffold: il primo comportamento end-to-end appartiene al Slice 1.
