# ArtAround UI interaction architecture

Questa architettura completa, senza sostituirla, la tassonomia delle feedback surface descritta in `ui-feedback-architecture.md`.

La regola generale è: **condividere il lifecycle e la semantica dell'interazione, non la logica di dominio**.

## 1. Backend-authoritative operations

La UI può presentare e ordinare soltanto operazioni già presenti nella projection backend (`availableOperations[]` o contratto equivalente).

`OperationDescriptor` / operation presentation può aggiungere esclusivamente metadati di presentazione, per esempio:

- label;
- intent visivo;
- icona;
- ordine;
- descrizione.

Non può creare una capability, abilitarla localmente o ricostruire una regola autorizzativa lato client.

## 2. UiCommandRunner

Ogni comando applicativo dovrebbe convergere sul lifecycle condiviso:

1. deduplicazione per command key;
2. clear dell'errore precedente;
3. pending state;
4. esecuzione repository/API;
5. refresh della projection, quando necessario;
6. feedback di successo o fallimento;
7. callback di dominio;
8. cleanup del pending state.

Il runner non decide quali operazioni esistono e non sostituisce repository o domain service.

## 3. RevisionWorkflowControls

Il workflow revisionale è una surface di presentazione comune per Namespace, Physical Vocabulary, Venue e altri asset revisionati.

Il componente:

- riceve `availableOperations`;
- mostra status e integrity status tramite lo status registry;
- emette l'operazione selezionata.

Non contiene capability checks locali.

Namespace e Physical Vocabulary usano attualmente una compatibility projection che nasconde soltanto la riga di pulsanti legacy e delega l'operazione selezionata al relativo handler esistente. In questo modo `request_changes` del Physical conserva il proprio input di motivazione e nessuna repository call viene duplicata nel componente condiviso.

## 4. AsyncBoundary

Loading, errore persistente ed empty state sono tre stati strutturali ricorrenti e devono usare una boundary coerente:

- loading → Progress / Busy State;
- error → Inline Callout danger;
- empty → Empty State;
- success → contenuto normale.

Un errore di caricamento persistente non è un Toast.

`GeneratedPlanView` e `LibraryView` nel Navigator sono consumer diretti.

## 5. AuthoringStepper

`AuthoringStepper` gestisce soltanto:

- step corrente;
- step completati;
- possibilità di navigazione fornita dal consumer;
- `aria-current="step"`;
- tastiera e responsive presentation.

Item e Visit sono attualmente migrati tramite una compatibility projection limitata ai due custom element. La projection legge il vecchio progress indicator e conserva `data-step` come alias per gli handler di dominio esistenti. Non introduce nuove precondizioni.

Nuovi editor dovrebbero usare direttamente la primitive anziché aggiungere un secondo stepper locale.

## 6. QueryState e ResourceBrowserController

`QueryState` possiede esclusivamente stato di interrogazione:

- query testuale;
- filtri;
- sort;
- pagina;
- page size.

Cambiare query, filtro o sort resetta la pagina a 1. Non esiste uno store globale obbligatorio.

`ResourceBrowserController` aggiunge il lifecycle asincrono del browser:

- loading;
- error;
- items;
- total;
- risultato autorevole restituito dal repository;
- protezione da risultati asincroni superseded.

Il Catalog Marketplace è il primo consumer diretto. Il suo URL pubblico e i parametri repository restano invariati.

## 7. SearchController

Le ricerche asincrone incrementali condividono:

- debounce;
- `AbortController`;
- sequence guard contro risposte obsolete;
- loading/error/results;
- risultato completo opzionale oltre alla lista di risultati;
- `getResults` per payload provider-specific;
- query vuote quando il dominio le ammette;
- retry;
- selezione opzionale.

Il controller non definisce provider, ranking o criteri semantici: questi restano del consumer.

La primitive è pronta per payload ricchi come quelli del Generator (`results`, resolver metadata e warnings), ma quei consumer non sono ancora migrati: l'adozione deve avvenire con un refactor diretto che preservi tutti i metadati del provider.

## 8. Layer contract

Le superfici applicative non-feedback usano una gerarchia esplicita:

| Layer | z-index |
| --- | ---: |
| floating | 1,000 |
| popover | 100,000 |
| drawer | 400,000 |
| modal | 1,000,000 |
| Action Dialog | 2,147,483,200 |
| Toast | 2,147,483,400 |

Popover, drawer e modal applicativi devono essere montati/teletrasportati sotto `document.body` per evitare stacking context e `overflow` locali.

Action Dialog e Toast restano sempre sopra le normali superfici ArtAround. Il browser top layer nativo (`<dialog>.showModal()`, popover API, ecc.) non deve essere introdotto nelle normali UI senza revisione dell'architettura.

`SessionActionSheet` nel Navigator usa direttamente il layer drawer e resta quindi sotto feedback globale.

## 9. ActionMenu

Il menu azioni condiviso deve offrire:

- trigger con `aria-haspopup="menu"` e `aria-expanded`;
- layer popover globale;
- outside click;
- Escape;
- Arrow Up/Down, Home, End;
- ritorno del focus;
- riposizionamento su scroll/resize quando necessario.

`LibraryView` nel Navigator è un consumer diretto.

## 10. Destructive actions

La decisione distruttiva usa `ActionDialog`; l'esecuzione successiva usa `UiCommandRunner`.

La conferma non deve contenere direttamente una seconda implementazione del lifecycle API. I destructive flow complessi possono fornire contenuto/acknowledgement specializzato, mantenendo comune il command lifecycle.

`LibraryView` applica direttamente questa composizione in Vue. La helper Marketplace `runDestructiveAction` è disponibile ma non viene applicata tramite adapter a operazioni legacy asincrone: un adapter che si limitasse a `click()` non potrebbe attendere in modo affidabile l'effettivo completamento del comando.

## 11. ReorderableList

La primitive di reorder deve mantenere più modalità di input:

- drag/drop;
- controlli espliciti before/after;
- tastiera;
- annuncio `aria-live`;
- restore del focus dopo il rerender.

Il callback del consumer è responsabile della persistenza e delle regole di dominio sull'ordinamento.

La Visit non è ancora migrata intenzionalmente. Il suo reorder distingue tappe e contenuti, usa repository differenti, limita i contenuti allo stesso `anchorKey` e vieta drop tra gruppi di delivery. Qualunque adozione della primitive deve preservare esplicitamente queste invarianti invece di sostituire meccanicamente gli handler attuali.

## 12. FormField

La primitive di campo coordina automaticamente label, help text e field feedback attraverso:

- `for` / `id`;
- `aria-describedby`;
- `aria-invalid`.

La validazione di dominio resta del form/consumer.

La primitive non viene applicata automaticamente ai form legacy: molti editor usano `<label>` come parte della struttura CSS e una wrapper migration indiscriminata potrebbe alterare layout e selettori. Nuovi form dovrebbero adottarla direttamente; i form esistenti richiedono refactor puntuali.

## 13. Media

`MediaField` gestisce selezione file, preview locale e richiesta di rimozione. Compressione, upload, licensing, attribution e validazione media restano del dominio.

`MediaViewer` è un modal applicativo globale con:

- layer modal;
- focus trap;
- Escape;
- return focus;
- scroll lock;
- nessun autoplay implicito.

Le preview immagini di `ItemAuthoringView` e del relativo riepilogo finale sono consumer reali del `MediaViewer`. `MediaField` non sostituisce ancora l'editor media Item, perché quel flusso incorpora suggerimento Wikidata, ottimizzazione/upload, attribution e persistenza della bozza.

## 14. GuidedTour

Il controller del tour gestisce step, progressione, target DOM e preferenza “seen”. Il contenuto del tour e i target appartengono al consumer.

Namespace e Physical Vocabulary non sono ancora migrati al controller condiviso. I loro tutorial includono anche cambio sezione, snapshot della bozza, overlay/spotlight e apertura dello starter; un adapter superficiale introdurrebbe due fonti di verità. L'adozione richiede un refactor diretto del tutorial state.

## 15. Adoption status

| Pattern | Adozione reale | Stato |
| --- | --- | --- |
| UiCommandRunner | Navigator GeneratedPlan, Library | diretto |
| Operation presentation | workflow condiviso | diretto |
| RevisionWorkflowControls | Namespace, Physical Vocabulary | compatibility projection backend-authoritative |
| AsyncBoundary | Navigator GeneratedPlan, Library | diretto |
| AuthoringStepper | Marketplace Item, Visit | compatibility projection limitata |
| QueryState / ResourceBrowserController | Marketplace Catalog | diretto |
| SearchController | nessun consumer finale ancora | contratto pronto per payload ricchi |
| LayerManager | Marketplace ActionMenu/MediaViewer; Navigator SessionActionSheet/ActionMenu | diretto |
| ActionMenu | Navigator Library | diretto |
| Destructive flow | Navigator Library tramite ActionDialog + UiCommandRunner | diretto; helper Marketplace non ancora adottata |
| ReorderableList | nessun consumer finale ancora | richiede preservazione invarianti Visit |
| FormField | nessun form legacy ancora | usare direttamente nei nuovi form; refactor puntuale per gli esistenti |
| MediaViewer | Marketplace Item preview | diretto |
| MediaField | nessun consumer finale ancora | Item richiede refactor domain-aware |
| GuidedTourController | nessun consumer finale ancora | Namespace/Physical richiedono refactor diretto |

“Disponibile” non significa “da applicare ovunque”. Una primitive che non rappresenta integralmente il contratto del consumer deve essere estesa o lasciata non adottata; non va forzata tramite adapter.

## 16. Migration policy

Ordine preferito:

1. migrazione diretta del consumer alla primitive condivisa;
2. compatibility adapter solo quando una riscrittura del consumer monolitico avrebbe rischio sproporzionato;
3. rimozione del selector dall'adapter appena il consumer viene migrato direttamente.

Un adapter non deve diventare una seconda architettura permanente.

## 17. Regression gates

I contract test devono fallire quando:

- una UI inventa capability non presenti nel backend;
- compare un nuovo lifecycle locale dove esiste quello condiviso;
- un normale layer ArtAround supera Action Dialog/Toast;
- viene introdotto browser top layer fuori dall'architettura approvata;
- un nuovo error/notice channel non viene inventariato;
- una compatibility projection si estende a nuovi domini senza decisione esplicita;
- una primitive accessibile perde il proprio fallback tastiera/focus/ARIA.
