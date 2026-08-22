# ArtAround — TW2026

ArtAround è una suite generica per musei, gallerie ed esposizioni composta da un backend Node.js/Express con MongoDB, un Navigator mobile e un Marketplace/Editor desktop-oriented.

## Applicazioni

- backend/API Node.js + Express alla root del repository;
- `clients/navigator`: Vue + Vite + TypeScript + Vue Router + Pinia;
- `clients/marketplace`: vanilla JavaScript, ES Modules e Web Components;
- MongoDB 7 come database di riferimento.

Dopo `npm run build:clients`, il processo Express serve le due applicazioni sullo stesso sito:

- `/navigator/` — Navigator;
- `/marketplace/` — Marketplace/Editor;
- `/api/...` — API condivise.

Il Navigator è configurato tramite `clients/navigator/public/navigator.config.json`; la configurazione corrente usa la Venue demo della Pinacoteca Nazionale di Bologna. Il Marketplace resta unico e generico rispetto alla Venue.

Il Marketplace include Catalog, Creator Workspace, Item authoring, EditorialRelease composition e Visit authoring. Il Visit editor crea o modifica le `VisitV2`, ricerca i contenuti delle EditorialRelease con paginazione server-side, permette aggiunta/rimozione/riordino e ruoli `core | recommended | optional`, collega i contenuti ai VenueTarget quando il Subject è presente nella Venue e usa il workflow editoriale proiettato dal backend. Le indicazioni logistiche della Visit sono gestite separatamente dai contenuti e non vengono modellate come Item.

## Installazione e verifica

```bash
npm ci
npm install --prefix clients/navigator --no-audit --no-fund
npm run check
npm run check:clients
npm run build:clients
npm test
```

Le variabili d'ambiente sono documentate in `.env.example`. In produzione configurare un `ADAPTIVE_CONTRIBUTOR_SECRET` casuale e stabile.

## Dataset d'esame

Con MongoDB attivo e `MONGO_URI` configurata:

```bash
npm run seed:demo
npm run verify:demo
```

Il seed è deterministico/idempotente per le entità demo e prepara:

- `autore1`, `autore2`, `visitatore1`, `visitatore2`, password `12345678`;
- `autore1` manager e `autore2` operator della Organization dimostrativa;
- Venue reale: **Pinacoteca Nazionale di Bologna**;
- VenueRelease/LayoutRevision con mappa schematica, routing e facility;
- 12 VenueTarget/opere;
- Namespace completo con durata, complessità linguistica, aspetti, selection signal, Subject class e relation type;
- 12 Item con più PresentationVariant/Representation;
- ContentSpace, EditorialContext, SemanticGraphRevision ed EditorialRelease;
- 3 Visit pubblicate, ciascuna con almeno 10 opere e interamente sulla stessa Venue;
- 3 Listing/Offer Marketplace, comprese offerte gratuite e una vendita simulata.

`npm run verify:demo` controlla automaticamente account/password, Venue/config Navigator, target/placement/map, corpus editoriale, Representation, tre Visit e Marketplace. Il seed richiama inoltre i consistency checker reali di Namespace, Item/Presentation, EditorialRelease, VenueRelease, Visit e Offer.

La mappa `pinacoteca-bologna-demo.svg` è intenzionalmente didattica e schematica: non rappresenta la planimetria ufficiale o lo stato operativo corrente del museo.

`npm run seed:users` resta disponibile quando servono soltanto i quattro account obbligatori.

## Avvio locale

Backend senza Docker:

```bash
npm start
```

Docker locale:

```bash
npm run dev:build
npm run logs
npm run down
```

`docker-compose.yml` serve per lo sviluppo locale. Il `Dockerfile` costruisce entrambi i client e avvia il backend, ma il deploy di dipartimento usa i container gocker forniti dal corso.

## Deploy di dipartimento

La procedura riproducibile è in `docs/deployment.md`. In sintesi:

1. `start mongo <sitename>` su gocker;
2. configurare `.env` con le credenziali/host Mongo forniti;
3. installare dipendenze e `npm run build:clients` nella directory del sito;
4. `npm run seed:demo && npm run verify:demo`;
5. in consegna avviare `start node-22 <sitename> index.js`.

## CI e controlli

La CI configura MongoDB 7 e verifica:

```bash
npm run check
npm run check:clients
npm run build:clients
npm test
npm audit --omit=dev --audit-level=high
npm audit --prefix clients/navigator --audit-level=high
```

I checker Slice 6–9 proteggono i boundary architetturali introdotti durante l'implementazione, compresi generator, workflow editoriale, Visit editor, separazione logistica/contenuti, dataset d'esame e static hosting.

## Documentazione canonica

- `docs/domain-model-v2.md` — modello di dominio v2;
- `docs/marketplace-domain-v2.md` — dominio commerciale capability-based;
- `docs/client-architecture-decisions.md` — decisioni client-v2 approvate;
- `docs/client-v2-implementation-plan.md` — vertical slice e criteri di completamento;
- `docs/client-v2-implementation-status.md` — stato operativo;
- `docs/revision-workflow.md` — workflow editoriale v2;
- `docs/deployment.md` — build, seed e deploy gocker;
- `docs/authentication-design.md` — autenticazione a sessione e cookie HttpOnly.

## Principi correnti

Le Visit pinzano snapshot editoriali immutabili; stato fisico, routing, timing e Representation concreta vengono risolti durante `ExecutionPreparation`/Session. VenueTarget e Layout appartengono al Physical Domain; Subject/Item/ContentSpace/EditorialContext al dominio editoriale. Marketplace e Navigator condividono lo stesso backend ma hanno responsabilità client differenti.

Il progetto non contiene dati produttivi da preservare: i refactoring possono aggiornare in modo coordinato schema, servizi, API, client e seed quando migliorano il Domain Model v2.
