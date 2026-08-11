# ArtAround — TW2026

Backend Node.js/Express con MongoDB per Marketplace/Editor e Navigator.

## Avvio

```bash
npm ci
npm start
```

Variabili richieste e opzionali sono documentate in `.env.example`. Per il learning collettivo configurare un `ADAPTIVE_CONTRIBUTOR_SECRET` stabile.

## Controlli

```bash
npm run check
npm test
```

## Documentazione tecnica

- `docs/authentication-design.md`: autenticazione a sessione e cookie HttpOnly;
- `docs/user-visit-design.md`: utenti, ruoli e visite official/community;
- `docs/community-vocabulary-strategy.md`: normalizzazione cross-museum e presentation policy;
- `docs/revision-workflow.md`: versionamento, revisione, pubblicazione e cestino;
- `docs/adaptive-logistics.md`: layout revisionato, routing accessibile, timing, profili adattivi e learning collettivo.

## Timing delle visite

Una `VisitRevision` pubblicata conserva una `baselineTiming` statica e versionata. Le stime realmente mostrate a un utente vengono invece calcolate runtime combinando representation selezionate, profilo personale, profili appresi di Item/arco/museo/visita e osservazioni della sessione corrente.

Il database di sviluppo non richiede migrazioni per il refactoring corrente: il progetto non contiene ancora dati persistenti da preservare.
