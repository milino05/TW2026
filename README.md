# ArtAround — TW2026

Backend Node.js/Express con MongoDB per Marketplace/Editor e Navigator.

## Avvio

```bash
npm ci
npm start
```

Variabili richieste e opzionali sono documentate in `.env.example`.

## Controlli

```bash
npm run check
npm test
```

## Documentazione tecnica

- `docs/authentication-design.md`: autenticazione a sessione e cookie HttpOnly;
- `docs/user-visit-design.md`: utenti, ruoli e visite official/community;
- `docs/community-vocabulary-strategy.md`: normalizzazione cross-museum e stima temporale;
- `docs/revision-workflow.md`: versionamento, revisione, pubblicazione e cestino.

Il database di sviluppo non richiede migrazioni per il refactoring corrente: il progetto non contiene ancora dati persistenti da preservare.
