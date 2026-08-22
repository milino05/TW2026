# ArtAround — Stato implementazione client-v2

Questo documento traccia lo stato operativo dei vertical slice definiti in `docs/client-v2-implementation-plan.md`. Il piano e le decisioni architetturali restano le fonti normative; questo file registra soltanto avanzamento e verifiche.

## Slice corrente

**Slice 3 — Action protocol v2 e runtime cleanup**

## Slice 0 — Repository e client scaffold

**Stato: implementato; verifica CI push non osservabile tramite il connector corrente.**

Completato su `main`:

- creato `clients/navigator` con Vue/Vite/TypeScript, Vue Router, Pinia, route shell, store boundary, capability boundary, `NavigatorStaticConfig` e adapter HTTP;
- creato `clients/marketplace` vanilla JavaScript con ES Modules, Web Component app shell, router application-level, adapter HTTP e build script senza framework;
- aggiunti script root `check:clients` e `build:clients`;
- CI estesa a install/check/build dei client;
- aggiornato `checkLegacyContracts.js` al path `generationV2.validation.js`;
- rimosso lo script npm morto `assign:museum-role`;
- README riallineato all'architettura client-v2;
- corretto il seed utenti per `organizationMemberships`;
- aggiunto ignore dei build output client.

## Slice 1 — Capability core + primo flusso end-to-end

**Stato: implementato nel codice; test automatici aggiunti; verifica CI push non osservabile tramite il connector corrente.**

Completato su `main`:

- capability registry generico e principal resolution User/Organization;
- `MarketplaceListing`, `MarketplaceOffer`, `MarketplaceAcquisition`, `Entitlement`;
- `CapabilityAuthorizationService` e migrazione di `visit.execute` a ownership/principal authority/Entitlement;
- Catalog Visit Listing-centric e acquisizione gratuita idempotente;
- Navigator Library/Detail e Marketplace Catalog come projection dedicate;
- distinzione `can execute != appears in personal Library`;
- client login/Catalog/acquire/Library/Detail/Session/NEXT/PREVIOUS;
- test capability e API end-to-end.

## Slice 2 — Execution source, Preparation e projections Navigator

**Stato: implementato nel codice; test automatici aggiunti; verifica CI push non osservabile tramite il connector corrente.**

Completato su `main`:

- `ResolvedVisitExecutionSource` effettivo tramite `resolveExecutableVisitRevisionV2` per owner/principal authority, Entitlement `follow_current` e Entitlement pinned;
- `pin_at_acquisition` risolve e conserva la `VisitRevision` acquisita; una nuova publication non sostituisce la source pinned;
- `ExecutionPreparation` transitoria con TTL, source esatta, `version`, optimistic concurrency, `PreparationDraft`, preference effettive, snapshot navigation, physical pins, candidate plan, readiness, `LogisticsPreview`, preVisit e consumption idempotente;
- lo start rivalida l'authorization sulla stessa VisitRevision preparata; revoca/cambio diritto incompatibile produce `PREPARATION_SOURCE_AUTHORIZATION_CHANGED`;
- `follow_current` non consente a un diritto acquisito dopo la preparation di autorizzare retroattivamente una vecchia source congelata;
- cambio del `Venue.publishedReleaseId` dopo la preparation produce `PREPARATION_PHYSICAL_STATE_CHANGED`;
- lo start persiste esattamente il `preparedPlanCandidate` e non invoca un secondo planner;
- errori di planning noti vengono proiettati come `readiness.status=blocked` con blocker stabili; una preparation blocked non può essere avviata;
- `preVisit.visitNotes` deriva dalla VisitRevision esatta e `preVisit.venues[].information` dalle stesse VenueRelease pinzate dalla preparation;
- Library e Detail usano la stessa execution-source resolution della preparation e quindi rispettano anche Entitlement pinned;
- Library verifica la coerenza fisica dei candidate e Detail applica anche la configured Venue come contesto fisico;
- session discovery/resume minimale via `GET /v2/navigator/sessions` e consumer nella Library;
- rimosso `POST /v2/visit-sessions` come creation endpoint;
- rimossi dal `VisitSessionService` anche gli helper interni `startVisitSessionV2`, `startGeneratedPlanSessionV2` e `startFromSource`: la creazione di Session passa soltanto da `ExecutionPreparation`;
- il Navigator Detail crea/aggiorna la preparation, mostra preVisit/readiness/logistics e modifica depth/complexity/movement pace con `expectedVersion` prima dello start;
- `checkLegacyContracts.js` impedisce il ritorno dello start diretto in route, client e service.

Test Slice 2:

- una preparation mantiene la VisitRevision iniziale dopo una nuova publication;
- una acquisition pinned continua a risolvere la revision acquisita;
- `expectedVersion` errata produce `PREPARATION_VERSION_CONFLICT`;
- start ripetuto restituisce la stessa Session e `alreadyStarted=true`;
- revoca del diritto sulla source preparata blocca lo start;
- planning fisico incoerente produce una preparation blocked;
- una preparation su VenueRelease R1 viene invalidata se la Venue passa a R2 prima dello start;
- una Session già avviata resta pinzata a R1, mentre una nuova preparation risolve R2;
- il test API percorre `login -> Catalog -> acquire -> Library -> Detail -> preparation/update -> start -> discovery -> NEXT -> PREVIOUS`;
- il test API verifica anche che `POST /v2/visit-sessions` non esista più.

## Stato della verifica automatica

La repository configura GitHub Actions per backend checks, build/check dei due client, test Node/Mongo e audit dipendenze. Il connector disponibile continua però a non esporre i workflow `push`: la ricerca dei run associati ai commit restituisce soltanto run PR e per i commit correnti non produce risultati. Per questo il codice e i test sono versionati, ma l'esito CI del commit corrente non viene dichiarato green senza evidenza osservabile.

## Prossimo incremento

Slice 3 sostituisce il runtime endpoint-specific con il protocollo Action approvato:

1. Action registry/definitions per famiglie generiche;
2. `AvailableAction` concrete e server-side, non semplici stringhe;
3. `POST /v2/visit-sessions/:sessionId/actions` con `ActionRequest` e re-derivation della disponibilità;
4. dispatcher verso use case runtime specializzati;
5. `InteractionEvent` generico con actor/action/channel/context/result/timestamp;
6. rename pubblico `PRESENTATION_LANGUAGE_* -> complexity` mantenendo locale/traduzione separati;
7. Navigator consumer unico per NEXT/PREVIOUS/presentation/lifecycle;
8. rimozione degli endpoint runtime specifici dal contratto client.
