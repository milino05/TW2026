# ArtAround — Stato implementazione client-v2

Questo documento traccia lo stato operativo dei vertical slice definiti in `docs/client-v2-implementation-plan.md`. Il piano e le decisioni architetturali restano le fonti normative; questo file registra soltanto avanzamento e verifiche.

## Slice corrente

**Slice 1 — Capability core + primo flusso end-to-end**

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

Verifiche eseguite nel workspace di sviluppo dell'assistente:

- Marketplace: `npm run check` superato;
- Marketplace: `npm run build` superato e `dist/` prodotto;
- Navigator: sorgenti TypeScript verificate sintatticamente con TypeScript disponibile localmente; la build Vue completa richiede le dipendenze npm e viene verificata dalla CI configurata;
- seed utenti modificato: `node --check` superato.

La mancata osservabilità del run push GitHub Actions non viene interpretata come esito positivo né negativo della CI.

## Prossimo incremento

Avviare Slice 1 dal capability core minimo, senza anticipare l'intero Marketplace commerciale:

1. capability registry e principal resolution;
2. `Entitlement` + Acquisition gratuita per `visit.execute`;
3. `CapabilityAuthorizationService` e migrazione dell'execution access;
4. Catalog Visit projection minima;
5. Navigator Library/Detail minima;
6. percorso E2E `acquire -> library -> detail -> start -> next/previous`.
