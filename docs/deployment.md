# Deploy ArtAround

Questo documento descrive il deploy dell'implementazione corrente. La procedura di dipartimento deriva da `Come attivare i docker di dipartimento.pdf`; ArtAround mantiene le credenziali fuori dal codice tramite `.env` invece di inserirle in `index.js`.

## Build e verifica prima della consegna

Da una clone pulita:

```bash
npm ci
npm install --prefix clients/navigator --no-audit --no-fund
npm run check
npm run check:clients
npm run build:clients
npm test
```

Con MongoDB disponibile e `MONGO_URI` configurata:

```bash
npm run migrate:organization-rbac
npm run seed:demo
npm run verify:demo
```

Il MongoDB di destinazione deve appartenere a un replica set: le mutazioni Organization RBAC e il relativo audit usano transazioni. Prima del deploy verificare con il gestore dell'ambiente che l'URI fornita includa il nome del replica set; un'istanza standalone non soddisfa il contratto corrente.

`seed:demo` è idempotente rispetto al dataset dimostrativo con ID deterministici. Non cancella genericamente il database: sostituisce soltanto le entità appartenenti al dataset ArtAround d'esame.

Dopo la build, lo stesso processo Express serve:

- API: `/api/...`;
- Navigator: `/navigator/`;
- Marketplace/Editor: `/marketplace/`;
- configurazione piattaforma Navigator: `/navigator-platform/navigator.config.json`;
- configurazioni musei: `/navigator-configs/:venueId/navigator.config.json`;
- map asset Navigator: `/maps/...`.

Titoli, immagini e palette del museo possono essere sostituiti senza ricompilare il client
tramite `NAVIGATOR_CONFIG_DIR`. La procedura completa è in [Configurare Navigator per un museo](navigator-branding.md).

## Docker locale

Il `Dockerfile` installa le dipendenze backend e Navigator, costruisce entrambi i client e avvia `index.js` tramite `npm start`.

```bash
docker compose up --build
```

Il `docker-compose.yml` è esclusivamente un ambiente di sviluppo locale; non sostituisce gocker.

## Dipartimento — gocker

La directory del sito assegnato è del tipo:

```text
/home/web/site2526XX/html/
```

Sostituire `site2526XX` con il proprio sitename reale.

### 1. Attivare MongoDB

Accedere a gocker:

```bash
ssh gocker.cs.unibo.it
```

Il comando documentato dal corso è:

```text
start <technology> <sitename> [<script>]
```

Per MongoDB:

```text
start mongo site2526XX
```

Gocker restituisce username, password e il nome host interno, nel formato `mongo_site2526XX`. Conservare queste informazioni: il servizio Mongo è raggiungibile dal container Node all'interno del cluster `tw.cs.unibo.it`. Il servizio deve essere configurato come replica set; includere `replicaSet=<nome>` nella URI restituita.

### 2. Configurare ArtAround

Nel sito, creare `.env` a partire da `.env.example`. Impostare almeno:

```dotenv
MONGO_URI=<URI MongoDB costruita con username, password e host restituiti da gocker>
PORT=8000
NODE_ENV=production
CORS_ORIGINS=
SESSION_COOKIE_SECURE=true
ADAPTIVE_CONTRIBUTOR_SECRET=<segreto casuale stabile>
NAVIGATOR_CONFIG_DIR=<directory lato server, facoltativa>
```

Su un database aggiornato da una versione precedente eseguire una sola volta `npm run migrate:organization-rbac` prima del seed/verifier o dell'avvio del nuovo backend.

La forma esatta della URI deve usare i parametri Mongo forniti al proprio sito. Non committare password o secret nel repository.

Il container Node di dipartimento richiede che l'applicazione ascolti sulla porta `8000`; `index.js` usa `PORT` e il valore di default del progetto è 8000.

### 3. Installare e costruire

Dalla directory `/home/web/site2526XX/html/`:

```bash
npm ci
npm install --prefix clients/navigator --no-audit --no-fund
npm run build:clients
```

Prima del primo avvio pubblico, con Mongo attivo:

```bash
npm run seed:demo
npm run verify:demo
```

La verifica deve terminare con `"ok": true`.

### 4. Avviare Node

Durante lo sviluppo il documento del corso permette `nodemon-22`:

```text
start nodemon-22 site2526XX index.js
```

Per la consegna usare `node-22`:

```text
start node-22 site2526XX index.js
```

Con `node-22`, dopo una modifica ai file occorre riavviare il container secondo i comandi disponibili su gocker. La consegna finale deve usare `node-22`, non `nodemon-22`.

### 5. Smoke test

Aprire:

```text
https://site2526XX.tw.cs.unibo.it/ping
https://site2526XX.tw.cs.unibo.it/navigator/
https://site2526XX.tw.cs.unibo.it/marketplace/
```

Verificare poi:

1. login con `visitatore1 / 12345678`;
2. selettore Navigator con i soli musei per cui l’utente possiede visite;
3. selezione della Pinacoteca e Library filtrata, senza barra di navigazione inferiore;
4. Marketplace filtrabile sulla Pinacoteca Nazionale di Bologna;
5. acquisizione di almeno una Visit demo e sua comparsa nella Library;
6. generazione e preparation/start della Visit nel contesto della Pinacoteca;
7. mappa schematica, servizi, TTS e bottoni equivalenti ai comandi vocali;
8. login autore e Creator Workspace/Editor funzionanti.

## Dataset della demo

Il dataset minimo verificato automaticamente contiene:

- i quattro account obbligatori;
- una Organization dimostrativa e la Venue reale `Pinacoteca Nazionale di Bologna`;
- una `VenueRelease` pubblicata con layout schematico, routing e facility;
- dodici VenueTarget/opere del corpus demo;
- Namespace, ContentSpace, EditorialContext, SemanticGraphRevision ed EditorialRelease;
- dodici Item con più livelli/Representation;
- tre Visit pubblicate, ciascuna con almeno dieci opere e interamente sulla stessa Venue;
- tre Listing con Offer attive, comprese offerte gratuite e una vendita simulata.

La mappa è dichiaratamente un asset didattico schematico e non va presentata come planimetria ufficiale o informazione operativa corrente della Pinacoteca.
