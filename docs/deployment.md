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
npm run migrate:exhibit-slots
npm run migrate:editorial-inventory
npm run seed:demo
npm run verify:demo
```

ArtAround supporta il MongoDB standalone fornito dall'ambiente di dipartimento. I servizi runtime non richiedono transazioni multi-documento o un replica set: per i lifecycle composti il documento live della risorsa è l'autorità di disponibilità e il cleanup delle proiezioni/distribuzioni derivate è idempotente. Il `docker-compose.yml` locale può continuare a usare un replica set per lo sviluppo, ma questa non è una dipendenza del deploy.

`seed:demo` è idempotente rispetto al dataset dimostrativo V3 con ID deterministici. Non cancella genericamente il database: sostituisce soltanto le entità appartenenti al dataset ArtAround d'esame.

Dopo la build, lo stesso processo Express serve:

- API: `/api/...`;
- Navigator: `/navigator/`;
- Marketplace/Editor: `/marketplace/`;
- configurazione piattaforma Navigator: `/navigator-platform/navigator.config.json`;
- configurazioni musei: `/navigator-configs/:venueId/navigator.config.json`;
- map asset Navigator: `/maps/...`.

Titoli, immagini e palette del museo possono essere sostituiti senza ricompilare il client tramite `NAVIGATOR_CONFIG_DIR`. La procedura completa è in [Configurare Navigator per un museo](navigator-branding.md).

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

Gocker restituisce username, password e il nome host interno, nel formato `mongo_site2526XX`. Conservare queste informazioni: il servizio Mongo è raggiungibile dal container Node all'interno del cluster `tw.cs.unibo.it`. Usare direttamente i parametri forniti da gocker nella `MONGO_URI`; non aggiungere requisiti di replica set non forniti dall'ambiente.

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

Su un database aggiornato da una versione precedente eseguire, prima del seed/verifier o dell'avvio del nuovo backend:

```bash
npm run migrate:organization-rbac
npm run migrate:exhibit-slots
npm run migrate:editorial-inventory
```

`migrate:exhibit-slots` e `migrate:editorial-inventory` supportano `--dry-run` e sono idempotenti. La migrazione dell'inventario editoriale copia le membership legacy nel nuovo inventario, ricostruisce le membership Subject e Collection, collega le revisioni ai nuovi grafi semantici e completa i binding delle release. I documenti legacy di origine non vengono eliminati.

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

La verifica deve terminare con `"status": "ok"` e `"dataset": "v3"`.

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
2. selettore Navigator e filtraggio delle visite possedute per museo;
3. configurazioni Navigator della Pinacoteca, del MAMbo e del Museo Civico Archeologico;
4. Marketplace con le sei visite demo e offerte attive;
5. acquisizione di almeno una Visit demo e sua comparsa nella Library;
6. generation/preparation/start di una visita nel contesto della Venue corretta;
7. mappe schematiche, servizi, TTS e bottoni equivalenti ai comandi vocali;
8. una visita sincronizzata con join alias e quiz;
9. login di `autore1` e `autore2` e corretta separazione delle tre Organization.

## Dataset della demo

Il dataset V3 verificato automaticamente contiene:

- i quattro account obbligatori;
- tre Organization: due di `autore1` e una di `autore2`;
- tre Venue reali di Bologna: Pinacoteca Nazionale, MAMbo e Museo Civico Archeologico;
- per ciascuna Venue una `VenueRelease` pubblicata con 12 VenueTarget, 12 ExhibitSlot, layout schematico, routing e servizi;
- regole editoriali d'arte con matrice 3×3 e regole archeologiche con matrice 2×2;
- un Item pubblicato per ogni Subject del grafo e almeno due collegamenti semantici per Subject;
- sei Visit pubblicate da almeno dieci tappe, di cui tre sulla Pinacoteca;
- due Visit sincronizzate con quiz finale;
- Listing con Offer attive, comprese offerte gratuite e vendite simulate.

Le mappe sono asset didattici schematici originali e non vanno presentate come planimetrie ufficiali o informazioni operative correnti. La struttura completa del dataset è descritta in `docs/demo-dataset-v3.md`.
