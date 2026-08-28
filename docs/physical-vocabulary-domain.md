# Physical Vocabulary

Questo documento descrive il dominio `PhysicalVocabulary` introdotto dal redesign del dominio fisico. La risorsa e autonoma, versionata e posseduta da un utente o da una Organization; non e un catalogo globale della piattaforma e non appartiene a una Venue.

## Risorsa e revisioni

`PhysicalVocabulary` contiene identita, ownership, puntatori alla revisione di lavoro e pubblicata, origine dell'eventuale fork e ciclo di vita `active`/`trashed`.

`PhysicalVocabularyRevision` e lo snapshot immutabile dopo la pubblicazione. Ogni revisione contiene quattro famiglie:

- `placeTypes`: tipi dei luoghi;
- `connectionTypes`: tipi dei collegamenti fisici;
- `physicalAttributes`: attributi tipizzati applicabili a luoghi, collegamenti o entrambi;
- `routingProfiles`: requisiti `required`, preferenze `preferred` e vincoli `avoid` riferiti agli UUID locali degli attributi.

Ogni definizione usa un `definitionId` UUID locale alla linea editoriale del vocabolario. `key` e un identificatore umano opzionale e non sostituisce l'UUID. Label, descrizione, alias e localizzazioni sono contenuto editoriale; `semanticRefs` contiene soltanto riferimenti semantici esterni. Alias e riferimenti semantici non vengono fusi.

Gli attributi supportano `boolean`, `number`, `string` e `choice`. La validazione controlla opzioni, unita di misura, applicabilita e compatibilita degli operatori usati dai profili. Un profilo non puo riferirsi a un attributo assente dalla stessa revisione.

## Riferimenti dal dominio fisico

`PhysicalFeatureRef` e lo schema riutilizzabile per i futuri Layout:

- riferimento locale: `kind: "local"`, `definitionId` e UUID della definizione nella revisione adottata;
- riferimento semantico: `kind: "semantic"`, `semanticRef` provider-neutral.

Il validatore impone l'esclusivita delle due forme. Il fork genera nuovi UUID per tutte le definizioni e rimappa i requisiti dei profili; preserva invece i riferimenti semantici.

## Starter

Lo starter crea una base di lavoro ricca ma non pubblica automaticamente. La versione corrente contiene 13 tipi di luogo, 8 tipi di collegamento, 9 attributi fisici e 4 profili di routing.

L'applicazione e non distruttiva e ripetibile: riconosce una voce tramite `key` o corrispondenza semantica esatta, aggiunge solo le definizioni mancanti e non sovrascrive label, alias, riferimenti rimossi o definizioni personalizzate. Se la corrispondenza semantica punta a una `key` differente o e ambigua, il command restituisce un conflitto non bloccante e conserva lo stato esistente. Lo starter resta quindi un acceleratore editoriale, non un catalogo fisico globale.

## Workflow

Il workflow segue quello delle altre risorse versionate:

1. creazione della risorsa e della revisione `draft`;
2. modifica e controllo di consistenza;
3. per una Organization, richiesta di review e blocco della revisione `in_review`;
4. pubblicazione, con superseding della precedente revisione;
5. apertura su richiesta di una nuova revisione di lavoro basata sulla pubblicata.

Un vocabolario personale puo essere pubblicato senza review manageriale. Un vocabolario Organization richiede review e un'autorita con permesso di pubblicazione. Cestino e ripristino agiscono sulla risorsa senza eliminare le revisioni.

## Permessi Organization

Il registry RBAC espone:

- `physical_vocabulary.view`;
- `physical_vocabulary.create`;
- `physical_vocabulary.edit`;
- `physical_vocabulary.review`;
- `physical_vocabulary.publish`;
- `physical_vocabulary.lifecycle.manage`.

I permessi operativi chiudono automaticamente la dipendenza da `view`. Tutti i command verificano nuovamente l'autorita nel backend; le projection Marketplace espongono solo operazioni effettivamente disponibili.

## API

Le route sono montate sotto `/api`:

- `GET|POST /physical-vocabularies`;
- `GET|PATCH|PUT /physical-vocabularies/:physicalVocabularyId`;
- `POST /physical-vocabularies/:physicalVocabularyId/fork`;
- `GET /physical-vocabularies/:physicalVocabularyId/revision`;
- `GET|PATCH|PUT /physical-vocabularies/:physicalVocabularyId/working-revision`;
- `POST /physical-vocabularies/:physicalVocabularyId/working-revision/apply-starter`;
- `POST /physical-vocabularies/:physicalVocabularyId/working-revision/check-consistency`;
- command `request-review`, `withdraw-review`, `request-changes` e `publish` sulla working revision;
- command `trash` e `restore` sotto `/lifecycle`.

La lettura dei metadata di una singola risorsa e della revisione pubblicata e pubblica. Elenco, working revision e command richiedono autenticazione; ownership e RBAC determinano poi l'autorizzazione effettiva.

## Integrazione Marketplace e confine della tranche

Marketplace riconosce `physical_vocabulary` e `physical_vocabulary_revision` come risorse distribuibili. Listing, offerte, acquisizione, capability di fork, Adoption e Creator Workspace usano snapshot pubblicati e non copie implicite.

Questa tranche introduce il dominio, le API e l'integrazione commerciale minima. Non effettua ancora il passaggio distruttivo di Venue/Layout, editor fisico, visite, routing o Navigator a `PhysicalVocabularyRevision`: quel lavoro deve avvenire nel successivo hard cutover, senza adattatori permanenti o doppie fonti di verita.
