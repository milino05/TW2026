# ArtAround — Stato implementazione client-v2

Questo documento traccia lo stato operativo dei vertical slice definiti in `docs/client-v2-implementation-plan.md`. Il piano e le decisioni architetturali restano le fonti normative; questo file registra soltanto avanzamento e verifiche.

## Slice corrente

**Slice 2 — Execution source, Preparation e projections Navigator**

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
- aggiunto ignore dei build output client;
- toolchain Navigator aggiornata alle release stabili verificate al momento dell'implementazione.

Verifiche eseguite durante lo Slice 0:

- Marketplace: check sintattico e build superati nel workspace disponibile;
- Navigator: sorgenti TypeScript verificate sintatticamente; la build Vue completa richiede le dipendenze npm;
- seed utenti modificato: controllo sintattico superato.

## Slice 1 — Capability core + primo flusso end-to-end

**Stato: implementato nel codice; test automatici aggiunti; verifica CI push non osservabile tramite il connector corrente.**

Completato su `main`:

- introdotto il capability registry generico per gli asset marketable approvati;
- aggiunti `MarketplaceListing`, `MarketplaceOffer`, `MarketplaceAcquisition` ed `Entitlement` con principal User/Organization e version policy;
- aggiunti `PrincipalResolutionService` e `CapabilityAuthorizationService`;
- migrato `visit.execute` da owner/membership-only a ownership personale, Organization principal authority oppure Entitlement valido;
- la risoluzione dei principal Organization considera soltanto Organization attive;
- aggiunto Catalog Visit Listing-centric, paginato e opzionalmente filtrato per Venue tramite PhysicalScope derivato dagli Anchor;
- aggiunta acquisizione gratuita idempotente: ogni acquisizione crea un evento `MarketplaceAcquisition` e gli Entitlement corrispondenti, con compensazione applicativa in caso di failure;
- l'API di acquisizione proietta `grantedUses` e non espone documenti Entitlement grezzi;
- aggiunte Navigator Library e Visit Detail projection dedicate;
- la Library personale contiene Visit user-owned e direct User Entitlement, ma non viene popolata automaticamente dalla Organization authority;
- `/auth/me` espone `organizationMemberships`, coerentemente con il modello corrente;
- Navigator implementa login, Library, Detail, start Session e runtime NEXT/PREVIOUS backend-authoritative;
- Marketplace vanilla implementa login, Catalog Visit, stato `alreadyUsable`, acquisizione gratuita e filtro Venue iniziale ricevuto dal Navigator;
- il Catalog distingue correttamente “già utilizzabile” dalla presenza nella Library personale;
- Marketplace e Navigator usano repository HTTP specifici per use case, non un God API service.

Contratto deliberatamente limitato nello Slice 1:

- le Offer `visit.execute` esposte dall'API sono gratuite e `follow_current`;
- `pin_at_acquisition`/execution pinned non viene simulata sul vecchio start e passa allo Slice 2 con `ResolvedVisitExecutionSource` e `ExecutionPreparation`;
- paid acquisition resta non implementata e viene rifiutata esplicitamente;
- gli endpoint runtime specifici `advance` rimangono temporaneamente il consumer di NEXT/PREVIOUS e verranno sostituiti dal protocollo Action nello Slice 3.

Test aggiunti:

- test Mongo del capability core: assenza iniziale del diritto, free acquisition, Entitlement, idempotenza, ownership invariata, Organization principal authority separata dalla Library personale;
- test API end-to-end: `login -> Catalog -> acquire -> Library -> Detail -> start Session -> NEXT -> PREVIOUS` usando una Visit editoriale content-only, caso supportato dal planner corrente senza inventare una Venue/layout fittizia;
- il test di compatibilità Mongo esistente carica automaticamente tutti i modelli e quindi include anche i nuovi schema/index Marketplace.

Limiti della verifica dell'assistente:

- il workspace locale non riesce a risolvere GitHub via DNS e non può clonare `main` per eseguire la suite completa;
- il connector GitHub corrente non espone uno status check osservabile per i push eseguiti (`statuses: []`);
- di conseguenza la presenza dei test e della CI configurata è verificata, ma il loro esito sul commit corrente non viene dichiarato come positivo senza evidenza.

## Prossimo incremento

Avviare Slice 2 sostituendo definitivamente lo start `visitId -> publishedRevisionId` con il boundary approvato:

1. `ResolvedVisitExecutionSource` per ownership/principal authority/Entitlement `follow_current | pinned`;
2. `ExecutionPreparation` transitoria e versionata;
3. effective presentation/navigation preference e expected physical snapshot;
4. `preparedPlanCandidate`, readiness e `LogisticsPreview` dalla stessa computation;
5. start preparation-centric e idempotente;
6. Library/Detail allineate alla stessa source resolution;
7. rimozione del fallback implicito alla latest VisitRevision durante lo start.
