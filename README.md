# ArtAround — TW2026

ArtAround è una suite generica per musei, gallerie ed esposizioni composta da un backend Node.js/Express con MongoDB, un Navigator mobile e un Marketplace/Editor desktop-oriented.

## Struttura corrente

- backend Node.js/Express alla root del repository;
- `clients/navigator`: Navigator Vue + Vite + TypeScript + Vue Router + Pinia;
- `clients/marketplace`: Marketplace/Editor vanilla JavaScript, ES Modules e Web Components;
- MongoDB 7 come database di riferimento.

Gli scaffold client sono il punto di partenza dell'implementazione client-v2; i flussi business vengono aggiunti per vertical slice secondo `docs/client-v2-implementation-plan.md`.

## Avvio backend

```bash
npm ci
npm start
```

Le variabili richieste e opzionali sono documentate in `.env.example`. Per il learning collettivo configurare un `ADAPTIVE_CONTRIBUTOR_SECRET` stabile e non usare il valore di sviluppo in produzione.

## Sviluppo locale backend con Docker

```bash
npm run dev:build
npm run logs
npm run down
```

`docker-compose.yml` avvia MongoDB 7 e il backend Node 22. Il `Dockerfile` avvia direttamente `npm start`; il comando `dev:container` con nodemon viene usato solo dal compose di sviluppo.

Il deploy sulle macchine del dipartimento usa invece i container gestiti da gocker (`mongo` e `node-22`/`nodemon-22`) secondo le istruzioni del corso; il compose locale non sostituisce quella procedura.

## Client

Installare le dipendenze del Navigator:

```bash
npm install --prefix clients/navigator
```

Avvio Navigator in sviluppo:

```bash
npm --prefix clients/navigator run dev
```

Il Marketplace non ha dipendenze runtime/build esterne nello scaffold corrente. Per verificare entrambi i client:

```bash
npm run check:clients
npm run build:clients
```

La configurazione statica del Navigator è in `clients/navigator/public/navigator.config.json` e contiene solo `schemaVersion`, `venueId` e branding. Il valore Venue presente nello scaffold deve essere sostituito dal seed/configurazione reale della demo.

## Controlli

Backend:

```bash
npm run check
npm test
npm audit --omit=dev
```

Client:

```bash
npm run check:clients
npm run build:clients
```

La CI esegue controlli legacy/hygiene, test backend con MongoDB 7 e build/check dei due client.

## Dati richiesti dal corso

```bash
npm run seed:users
```

Questo comando crea o ripristina gli account `autore1`, `autore2`, `visitatore1`, `visitatore2` con password iniziale `12345678`.

Il seed completo di Venue, layout, contenuti e delle tre Visit da almeno dieci opere sulla stessa Venue è ancora un'attività di implementazione prevista dal piano client-v2 e deve essere completato prima della consegna.

## Documentazione canonica

- `docs/domain-model-v2.md`: modello di dominio v2;
- `docs/marketplace-domain-v2.md`: dominio commerciale capability-based;
- `docs/client-architecture-decisions.md`: audit/decisioni client-v2 approvate, punti 1–30;
- `docs/client-v2-implementation-plan.md`: vertical slice e criteri di completamento;
- `docs/authentication-design.md`: autenticazione a sessione e cookie HttpOnly.

Documenti storici incompatibili con Domain v2 non costituiscono fonte di verità e devono essere riscritti o rimossi durante il cleanup previsto dal piano.

## Principi runtime correnti

Le Visit editoriali pinzano contenuti e snapshot editoriali immutabili, mentre stato fisico, routing e timing vengono risolti per preparation/session secondo le decisioni client-v2. Le stime runtime dipendono da presentation, routing, movimento, VenueRelease/LayoutRevision e learning; non vengono trattate come proprietà statica autorevole della VisitRevision.

Il database di sviluppo non richiede retrocompatibilità o migrazioni legacy: il progetto non contiene dati produttivi da preservare e i refactoring possono aggiornare in modo coordinato schema, servizi, API, client e seed.
