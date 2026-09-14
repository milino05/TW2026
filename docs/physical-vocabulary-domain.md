# Physical Vocabulary

Questo documento descrive il dominio `PhysicalVocabulary` introdotto dal redesign del dominio fisico. La risorsa è autonoma, versionata e posseduta da un utente o da una Organization; non è un catalogo globale della piattaforma e non appartiene a una Venue.

## Risorsa e revisioni

`PhysicalVocabulary` contiene identità, ownership, puntatori alla revisione di lavoro e pubblicata, origine dell'eventuale fork e ciclo di vita `active`/`trashed`.

`PhysicalVocabularyRevision` è uno snapshot immutabile dopo la pubblicazione. Ogni revisione contiene quattro famiglie:

- `placeTypes`: tipi dei luoghi;
- `connectionTypes`: tipi dei collegamenti fisici;
- `physicalAttributes`: attributi tipizzati applicabili a luoghi, collegamenti o entrambi;
- `routingProfiles`: requisiti `required`, preferenze `preferred` e vincoli `avoid` riferiti agli UUID locali degli attributi.

Ogni definizione usa un `definitionId` UUID locale alla linea editoriale del vocabolario. `key` è un identificatore umano opzionale e non sostituisce l'UUID. Label, descrizione, alias e localizzazioni sono contenuto editoriale; `semanticRefs` contiene soltanto riferimenti semantici esterni. Alias e riferimenti semantici non vengono fusi.

Gli attributi supportano `boolean`, `number`, `string` e `choice`. La validazione controlla opzioni, unità di misura, applicabilità e compatibilità degli operatori usati dai profili. Un profilo non può riferirsi a un attributo assente dalla stessa revisione.

## Riferimenti dal dominio fisico

`PhysicalFeatureRef` è lo schema riutilizzabile per Layout, routing, preferenze e Navigator:

- riferimento locale: `kind: "local"`, `physicalVocabularyId` e `definitionId` della definizione nella revisione adottata;
- riferimento semantico: `kind: "semantic"`, insieme di `semanticRefs` provider-neutral.

Il validatore impone l'esclusività delle due forme. Il fork genera nuovi UUID per tutte le definizioni e rimappa i requisiti dei profili; preserva invece i riferimenti semantici.

Alias e riferimenti semantici hanno responsabilità diverse: un alias descrive come una persona può chiamare una feature, mentre un riferimento semantico stabilisce un significato interoperabile tra vocabolari. Il resolver non inventa equivalenze mancanti.

## Starter

Lo starter crea una base di lavoro ricca ma non pubblica automaticamente. La versione corrente contiene 13 tipi di luogo, 8 tipi di collegamento, 9 attributi fisici e 4 profili di routing.

L'applicazione è non distruttiva e ripetibile: riconosce una voce tramite `key` o corrispondenza semantica esatta, aggiunge solo le definizioni mancanti e non sovrascrive label, alias, riferimenti rimossi o definizioni personalizzate. Se la corrispondenza semantica punta a una `key` differente o è ambigua, il command restituisce un conflitto non bloccante e conserva lo stato esistente. Lo starter resta quindi un acceleratore editoriale, non un catalogo fisico globale.

## Workflow

Il workflow segue quello delle altre risorse versionate:

1. creazione della risorsa e della revisione `draft`;
2. modifica e controllo di consistenza;
3. per una Organization, richiesta di review e blocco della revisione `in_review`;
4. pubblicazione, con superseding della precedente revisione;
5. apertura su richiesta di una nuova revisione di lavoro basata sulla pubblicata.

Un vocabolario personale può essere pubblicato senza review manageriale. Un vocabolario Organization richiede review e un'autorità con permesso di pubblicazione.

La pubblicazione di una nuova revisione non rende automaticamente incoerenti tutti i consumer. Gli audit di dipendenza confrontano la nuova revisione con i riferimenti realmente usati da ciascun consumer. Un'aggiunta che non modifica il significato delle definizioni già utilizzate è normalmente compatibile; una rimozione o una modifica incompatibile richiede intervento solo per le risorse che usano davvero la definizione interessata.

## Lifecycle, Marketplace e snapshot

Il lifecycle dell'aggregate e il lifecycle degli snapshot sono separati intenzionalmente.

Quando un `PhysicalVocabulary` viene rimosso dalla propria Libreria:

- l'aggregate passa a `trashed`;
- le Listing che distribuiscono la risorsa o una sua revisione vengono ritirate;
- le Offer collegate diventano inattive;
- le revisioni non vengono eliminate;
- Acquisition, Entitlement e Adoption già esistenti non vengono cancellati;
- una `PhysicalVocabularyRevision` già referenziata da uno snapshot storico continua a essere leggibile come baseline immutabile.

Questa distinzione impedisce che il trash della lineage modifichi retroattivamente snapshot pubblicati, Session già pinzate o acquisizioni già avvenute. Al contrario, nuovo authoring o nuove adozioni che richiedono la risorsa live richiedono un `PhysicalVocabulary` ancora `active`.

Il comando storico `POST /physical-vocabularies/:physicalVocabularyId/lifecycle/trash` usa lo stesso use case coordinato della rimozione Workspace; non esiste una seconda semantica che possa lasciare Listing o Offer attive. Il restore riattiva la lineage ma non ripubblica automaticamente la distribuzione Marketplace precedentemente ritirata: una nuova distribuzione è una decisione esplicita del proprietario.

## Permessi Organization

Il registry RBAC espone:

- `physical_vocabulary.view`;
- `physical_vocabulary.create`;
- `physical_vocabulary.edit`;
- `physical_vocabulary.review`;
- `physical_vocabulary.publish`;
- `physical_vocabulary.lifecycle.manage`.

I permessi operativi chiudono automaticamente la dipendenza da `view`. Tutti i command verificano nuovamente l'autorità nel backend; le projection Marketplace espongono solo operazioni effettivamente disponibili.

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

La lettura dei metadata di una singola risorsa e della revisione pubblicata è pubblica. Elenco, working revision e command richiedono autenticazione; ownership e RBAC determinano poi l'autorizzazione effettiva.

## Integrazione Marketplace e layout fisici

Marketplace riconosce `physical_vocabulary` e `physical_vocabulary_revision` come risorse distribuibili. Listing, offerte, acquisizione, capability di fork, Adoption e Creator Workspace usano snapshot pubblicati e non copie implicite.

Una `Venue` dipende dalla lineage `PhysicalVocabulary` tramite `physicalVocabularyId` e `physicalVocabularyDependency`. La policy è `follow_current` per una dependency live interna o per un entitlement che segue la lineage, ed è `pinned` soltanto quando il diritto autorizza esplicitamente uno snapshot storico. La revisione effettiva di una dependency `follow_current` è sempre la `publishedRevisionId` corrente della lineage.

`LayoutRevision.authoredAgainstPhysicalVocabularyRevisionId` conserva invece la **provenance di authoring**: identifica la revisione contro cui quello snapshot di layout è stato scritto e originariamente validato. Place, Connection e valori tipizzati continuano a memorizzare i `definitionId`; il campo `authoredAgainst...` non significa però che una Venue live debba continuare a usare quella revisione per sempre.

Quando viene pubblicata una nuova `PhysicalVocabularyRevision`, il dependency audit rivalida le Venue live `follow_current` che appartengono allo stesso owner. Se i `definitionId`, tipi, valori e vincoli realmente usati dal Layout restano validi, la stessa VenueRelease/LayoutRevision viene automaticamente considerata valida contro la nuova revisione effettiva: non viene generato un nuovo Layout solo per un cambiamento additivo. Se esiste invece una reale incompatibilità, la dependency passa a `needs_review` e il consumer live non può usare silenziosamente la vecchia revisione superseded come fallback.

Le revisioni superseded restano leggibili quando servono come snapshot storico. In particolare una Session pinza esplicitamente `physicalVocabularyRevisionId`; una lettura storica di un Layout può usare `authoredAgainstPhysicalVocabularyRevisionId`. Questi casi non devono essere confusi con la risoluzione live della Venue.

Le preferenze fisiche riutilizzabili usano `PhysicalFeatureRef`. Un riferimento locale identifica direttamente una definizione quando il vocabolario è già noto; un riferimento semantico consente al backend di risolvere la stessa feature in vocabolari diversi tramite `semanticRefs`. Requirement `required` non risolvibili bloccano la preparation, mentre requirement soft producono warning e non vengono scartati silenziosamente.

Il routing e il Navigator risolvono la revisione fisica effettiva della Venue durante la preparation, ne verificano la dependency e poi la pinzano nella Session. Il motore del grafo rimane generico: valuta gli `attributeValues` locali dopo che il resolver ha tradotto i riferimenti fisici e non dipende da chiavi canoniche globali o da nomi hardcoded.

## Authoring Venue

La Venue non riscrive più una VenueRelease o un Layout come mega-snapshot proveniente dal frontend. Il frontend invia command applicativi granulari: creazione e modifica di piani, upload della planimetria, calibrazione, Place, Connection, attributi fisici tipizzati, geometria, collocazione VenueTarget, disponibilità, recognition media e informazioni pre-visita.

La scelta iniziale del vocabolario avviene a livello di lineage (`physicalVocabularyId`), non scegliendo manualmente una revisione operativa. Una nuova working LayoutRevision registra come `authoredAgainstPhysicalVocabularyRevisionId` la revisione effettiva stabile usata in quel momento.

`POST /venues/:venueId/working-release` rimane l'operazione che apre o assicura una working release; non esiste più un `PATCH /venues/:venueId/working-release` per sostituire arbitrariamente l'aggregate. Review, controllo di consistenza e pubblicazione restano command espliciti sul workflow.

## Lifecycle Venue e VenueTarget

Una `Venue` ha lifecycle `active`/`trashed`. Il trash non cancella VenueRelease, LayoutRevision, VenueTarget o Visit: conserva lo storico e rende la Venue indisponibile alle nuove superfici operative. Prima della rimozione la UI può richiedere un impact projection che espone il numero di VenueTarget e di Visit pubblicate correnti dipendenti dalla sede.

Un `VenueTarget` rappresenta una presenza fisica e non elimina mai `Subject` o `Item` editoriali. Il trash è bloccato se il target è ancora:

- nella configurazione fisica di lavoro;
- nella configurazione fisica pubblicata;
- usato come anchor dalla revisione pubblicata corrente di una Visit attiva.

Floor, Place e Connection non hanno un lifecycle autonomo: sono componenti della working `LayoutRevision` e vengono gestiti tramite command di authoring con i relativi vincoli di integrità.
