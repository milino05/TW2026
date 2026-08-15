# ArtAround — TW2026

Backend Node.js/Express con MongoDB per Marketplace/Editor e Navigator.

## Avvio diretto

```bash
npm ci
npm start
```

Le variabili richieste e opzionali sono documentate in `.env.example`. Per il learning collettivo configurare un `ADAPTIVE_CONTRIBUTOR_SECRET` stabile e non usare il valore di sviluppo in produzione.

## Sviluppo locale con Docker

```bash
npm run dev:build
npm run logs
npm run down
```

`docker-compose.yml` avvia MongoDB 7 e il backend Node 22. Il `Dockerfile` avvia direttamente `npm start`; il comando `dev:container` con nodemon viene usato solo dal compose di sviluppo.

Il deploy sulle macchine del dipartimento usa invece i container gestiti da gocker (`mongo` e `node-22`/`nodemon-22`) secondo le istruzioni del corso; il compose locale non sostituisce quella procedura.

## Controlli

```bash
npm run check
npm test
npm audit --omit=dev
```

`npm run check` verifica sintassi JavaScript, assenza dei contratti legacy operativi e igiene dei file tracciati. La CI avvia anche MongoDB 7 e inizializza tutti gli schemi/indici Mongoose per intercettare incompatibilita reali con il database previsto.

## Dati richiesti dal corso

```bash
npm run seed:users
```

Questo comando crea o ripristina gli account `autore1`, `autore2`, `visitatore1`, `visitatore2` con password iniziale `12345678`. Il popolamento completo di museo, contenuti e visite dimostrative resta un'attivita di consegna distinta dallo schema applicativo.

## Documentazione tecnica

- `docs/authentication-design.md`: autenticazione a sessione e cookie HttpOnly;
- `docs/user-visit-design.md`: utenti, ruoli e visite official/community;
- `docs/community-vocabulary-strategy.md`: normalizzazione cross-museum e presentation policy;
- `docs/revision-workflow.md`: versionamento, revisione, pubblicazione e cestino;
- `docs/adaptive-logistics.md`: layout revisionato, routing accessibile, timing, profili adattivi e learning collettivo;
- `docs/semantic-knowledge-and-generation.md`: knowledge graph, PresentationVariant e generatore;
- `docs/runtime-adaptive-planning.md`: sessioni, replanning e apprendimento runtime.

## Timing delle visite

Una `VisitRevision` pubblicata conserva una `baselineTiming` statica e versionata. Le stime mostrate a un utente vengono invece calcolate runtime combinando representation selezionate, profilo personale, profili appresi di Item/arco/museo/visita e osservazioni della sessione corrente.

Il database di sviluppo non richiede migrazioni per il refactoring corrente: il progetto non contiene ancora dati persistenti da preservare.
