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

Il Navigator supporta una configurazione di piattaforma e configurazioni specifiche per Venue sotto `clients/navigator/public/navigator-configs/:venueId`. Il Marketplace resta unico e generico rispetto alla Venue.

Dopo il login il Marketplace apre un **Context Hub**: l'utente sceglie se operare nella propria area personale oppure per una Organization a cui ha accesso. Il contesto è una preferenza di sessione e non sostituisce authorization, ownership, Entitlement o selezione della Venue; il backend continua a essere autorevole sui principal e sulle capability. La navigazione principale è **Home · Esplora · Libreria · Crea · Marketplace · Account**, mentre **Esplora** comprende Catalogo, Organizzazioni e Sedi.

Il Marketplace include Catalog, Creator Workspace/Libreria, Item authoring, EditorialRelease composition e Visit authoring. Il Visit editor crea o modifica le `VisitV2`, ricerca i contenuti delle EditorialRelease con paginazione server-side, permette aggiunta/rimozione/riordino e ruoli `core | recommended | optional`, collega i contenuti ai VenueTarget quando il Subject è presente nella Venue e usa il workflow editoriale proiettato dal backend. Le indicazioni logistiche della Visit sono gestite separatamente dai contenuti e non vengono modellate come Item.

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
npm run migrate:organization-rbac
npm run seed:demo
npm run verify:demo
```

Il seed canonico è il **dataset V3 multi-museo** e prepara:

- `autore1`, `autore2`, `visitatore1`, `visitatore2`, password `12345678`;
- 3 Organization: due di proprietà di `autore1`, una di `autore2`;
- 3 Venue reali di Bologna: **Pinacoteca Nazionale di Bologna**, **MAMbo — Museo d'Arte Moderna di Bologna** e **Museo Civico Archeologico di Bologna**;
- 12 VenueTarget e 12 ExhibitSlot per ciascuna Venue, con LayoutRevision, routing, servizi e mappa schematica dall'alto;
- per Pinacoteca e MAMbo, regole editoriali coerenti con il modello culturale starter corrente di ArtAround: 3 durate × 3 livelli di linguaggio e 3 relation type;
- per il Museo Civico Archeologico, regole dedicate con 2 durate × 2 livelli e 3 relation type;
- un Item pubblicato per ogni Subject del grafo e almeno due collegamenti semantici incidenti per ogni Subject;
- una matrice completa durata × livello di linguaggio in ogni Item: 9 Representation per Item artistico, 4 per Item archeologico;
- 6 Visit pubblicate, tutte con almeno 10 tappe; le prime 3 sono sulla Pinacoteca per preservare il requisito minimo di tre visite sullo stesso museo;
- 2 Visit sincronizzate con alias semplice e quiz finale: **Classe alla Pinacoteca** e **Bologna antica: laboratorio di archeologia**;
- Listing/Offer Marketplace per tutte le visite, con offerte gratuite e a pagamento simulato.

`npm run verify:demo` controlla account/password, ownership delle Organization, Namespace, matrici complete di Representation, copertura Item/Subject, grado minimo del grafo, target/slot/mappe, integrità delle VenueRelease, sei Visit, due visite sincronizzate e Marketplace.

Le mappe V3 sono illustrazioni schematiche originali per la demo: **non rappresentano planimetrie ufficiali né lo stato operativo corrente dei musei**. Dettagli, struttura e fonti usate per il dataset sono in `docs/demo-dataset-v3.md`.

I file `examDatasetV2.js`, `auroraDatasetV2.js` ed `examPresentationMatrix.js` restano nel repository come fixture/strumenti legacy usati da test esistenti, ma non fanno più parte del comando canonico `seed:demo`.

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

I checker Slice 6–9 proteggono i boundary architetturali introdotti durante l'implementazione, compresi generator, workflow editoriale, Visit editor, separazione logistica/contenuti, dataset d'esame e static hosting. I contract UX Marketplace proteggono inoltre il Context Hub e l'assenza dei selector locali di principal senza congelare microcopy non normativa.

## Documentazione canonica

- `docs/domain-model-v2.md` — modello di dominio v2;
- `docs/marketplace-domain-v2.md` — dominio commerciale capability-based;
- `docs/client-architecture-decisions.md` — decisioni client-v2 approvate;
- `docs/marketplace-context-hub-ia.md` — decisione corrente per Context Hub, IA contestuale e separazione discovery/management;
- `docs/client-v2-implementation-plan.md` — vertical slice e criteri di completamento;
- `docs/client-v2-implementation-status.md` — stato operativo;
- `docs/revision-workflow.md` — workflow editoriale v2;
- `docs/deployment.md` — build, seed e deploy gocker;
- `docs/demo-dataset-v3.md` — struttura e invarianti del dataset demo multi-museo;
- `docs/authentication-design.md` — autenticazione a sessione e cookie HttpOnly;
- `docs/semantic-resolver-v2.md` — resolver provider-neutral, identity binding e integrazioni authoring;
- `docs/organization-rbac.md` — ruoli Organization personalizzati, permission registry, Owner, transazioni, audit e migrazione legacy.

## Principi correnti

Le Visit pinzano snapshot editoriali immutabili; stato fisico, routing, timing e Representation concreta vengono risolti durante `ExecutionPreparation`/Session. VenueTarget e Layout appartengono al Physical Domain; Subject/Item/ContentSpace/EditorialContext al dominio editoriale. Marketplace e Navigator condividono lo stesso backend ma hanno responsabilità client differenti.

Il progetto non contiene dati produttivi da preservare: i refactoring possono aggiornare in modo coordinato schema, servizi, API, client e seed quando migliorano il Domain Model v2.
