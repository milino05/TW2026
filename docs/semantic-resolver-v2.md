# ArtAround — Semantic Resolver v2

Questo documento descrive il contratto implementato sul branch locale `codex/marketplace_simo`, adattando la specifica auditata del Semantic Resolver al Domain Model v2 già presente nel branch.

## Confini

- ArtAround rimane la source of truth; Wikidata è il primo provider, non il dominio autorevole.
- Il resolver trasferisce soltanto query, locale e tipo di entità necessari alla ricerca.
- Il browser chiama esclusivamente il backend ArtAround; non interroga direttamente l'Action API.
- Candidate esterna, `semanticRef` di vocabolario e `Subject.externalIdentity` confermata sono oggetti distinti.
- Il resolver non importa statement, immagini, graph edge, classi, domain/range o contenuti editoriali.
- Visita, runtime e normali query del visitatore non creano Subject.

## Persistenza Subject

`Subject.externalIdentities[]` è embedded nel Subject. Ogni voce contiene:

- `scheme` e `id` provider-neutral;
- `role: canonical | historical`;
- `canonicalId` soltanto per un ID storico;
- `confirmation.source`, `confirmedAt`, `confirmedBy` come provenance della decisione ArtAround;
- `verification.status` e `checkedAt` come stato separato della verifica live.

Un indice MongoDB unique multikey garantisce l'unicità atomica globale di `(scheme, id)`. La validazione del documento impedisce duplicati interni, più ID canonici dello stesso scheme e ID storici senza la corrispondente identità canonica. Non esiste dual-read del precedente `Subject.externalRefs`.

## Provider Wikidata

L'adapter usa l'Action API:

- `wbsearchentities` per discovery testuale di Item `Q` o Property `P`;
- `wbgetentities` con `redirects=yes` per resolution, fingerprint localizzato e canonicalizzazione.

Il payload conserva soltanto ID, entity kind, label, description, alias, redirect e attribution. Timeout, cache TTL limitata, limite massimo di entry e request coalescing sono configurabili tramite ambiente. Il backend invia un User-Agent identificabile e propaga l'indicazione `Retry-After` come header e dettaglio di indisponibilità, senza confondere `unavailable` con `not_found`.

Le ricerche e resolution richieste da Marketplace e Navigator sono operazioni interattive: non inviano `maxlag`, come consentito dalle linee guida MediaWiki per una persona in attesa del risultato. La modalità provider `background`, predisposta per futuri batch, usa invece `maxlag=5`.

`maxlag`, rate limiting, HTTP `429/502/503/504`, timeout, errori di rete e risposte non valide sono classificati separatamente. Il provider esegue al massimo un retry con backoff breve; un `Retry-After` superiore al budget automatico non blocca l'interfaccia e viene restituito al client. Errori API permanenti non vengono ritentati. I fallimenti non entrano nella cache.

## API autenticate

```text
GET  /api/v2/semantic-resolver/providers
GET  /api/v2/semantic-resolver/search?scheme=wikidata&query=...&entityKind=item|property&locale=it
GET  /api/v2/semantic-resolver/resolve?scheme=wikidata&id=Q...&locale=it
POST /api/subjects/from-external-identity
```

Il command `from-external-identity` accetta `scheme`, `id`, `locale` e le scelte ArtAround opzionali `preferredLabel`/`description`. Il server risolve nuovamente l'ID e non si fida del payload Candidate ricevuto dal client.

Esiti:

- `created`: nuovo Subject con identity canonica verificata e, in caso di redirect, ID storico preservato;
- `reuse_existing`: l'identity richiesta o canonica è già bound e viene restituito il Subject esistente;
- `RECONCILIATION_REQUIRED`: requested e canonical ID risultano bound a Subject diversi; nessun auto-merge;
- `UNSUPPORTED_SCHEME`, `PROVIDER_UNAVAILABLE`, `EXTERNAL_IDENTITY_NOT_FOUND`: esiti distinti con stato HTTP coerente.

`POST /api/subjects` crea esclusivamente Subject locali senza identity. Correzione, rimozione o sostituzione di binding esistenti non sono esposte finché non esiste semantic stewardship/RBAC dedicata.

## Integrazione client

Il Marketplace usa un picker riusabile con due modalità:

- Subject: un'unica query cerca prima in ArtAround e, quando non trova risultati, continua automaticamente su Wikidata; una Candidate già bound riporta al Subject ArtAround esistente, mentre assenza o rifiuto dei risultati rende disponibile la creazione locale;
- mapping: discovery di Wikidata Item/Property e scelta esplicita fra `exact`, `close`, `broader`, `narrower`.

La modalità Subject è integrata nell'Item authoring e nella creazione dei VenueTarget. La modalità mapping è integrata in tutte le definition del Namespace e nei PlaceType del Venue editor; `PlaceType.userIntents` rimane separato da `PlaceType.semanticRefs`.

Gli alias restituiti dal provider, per esempio “Mona Lisa” per un Subject ArtAround denominato “Gioconda”, non vengono persistiti come metadati locali. La query esterna riconosce l'identità già bound e propone il riuso del Subject esistente. Se esistono risultati testuali locali non pertinenti, l'utente può estendere la stessa query a Wikidata senza usare una seconda barra di ricerca.

Dopo l'esaurimento del retry server-side, il picker mantiene disponibile la creazione locale e mostra un'azione esplicita “Riprova Wikidata”; quando presente, comunica anche l'attesa minima indicata dal provider. Il fallback completo non viene più mostrato per un singolo errore transitorio recuperabile.

Il generatore Navigator effettua fallback esterno soltanto dopo la ricerca locale e soltanto quando la query non è vuota. Una Candidate esterna può produrre un risultato esclusivamente se è già bound a un Subject presente nelle EditorialSource selezionate. Il fallback non persiste dati e un provider indisponibile lascia operative ricerca locale e generazione.

## Fuori scope

Restano esplicitamente fuori da questa implementazione: Semantic Enrichment, import di statement, LLM, Explorer globale, consolidamento Subject, modifica automatica dei binding, dashboard di reconciliation e maintenance periodica dei riferimenti.
