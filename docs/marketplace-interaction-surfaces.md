# Marketplace interaction surfaces

Questo documento specializza `ui-interaction-architecture.md` per il Marketplace ArtAround.

La regola è: **la surface dipende dal tipo di attività, non dal fatto che esista un form**. Condividere lifecycle e meccaniche di interazione non significa spostare logica di dominio dentro componenti generici.

## 1. Surface canoniche

### Task Modal

Usare per task autonomi e circoscritti con un risultato definito: creazione di una risorsa, modifica puntuale, selezione di una risorsa necessaria a un comando, configurazione breve.

Non usare per workflow lunghi e iterativi. Item Authoring, Visit Authoring, Namespace Editor, Physical Vocabulary Editor e il workspace spaziale della Venue restano editor/pagine dedicate.

### Action Dialog

Usare quando l'azione deve attendere una decisione esplicita. Conferme sensibili e distruttive non devono essere implementate come pannelli inline locali.

### Message Action Dialog

Variante di Action Dialog per operazioni che richiedono un breve messaggio o motivazione, per esempio `request_changes`. Non sostituisce un editor testuale generale.

### Rich Action Dialog

Decisione strutturata per operazioni che richiedono più contesto di una singola frase, per esempio l'acquisizione di una licenza con beneficiario, prezzo, aggiornamenti e diritti. Mantiene la semantica non distruttiva di Escape/backdrop/X.

### Inline editor

Usare quando la modifica è piccola, strettamente legata all'oggetto visibile e non destabilizza il layout. Filtri, preferenze persistenti e campi media contestuali possono restare inline.

### Full-page / workspace editor

Usare per authoring lungo, iterativo, grafi, mappe o attività in cui il confronto continuo con il contesto è parte del lavoro.

## 2. Inspector e sidecar

Inspector laterali e sidecar sovrapposti **non fanno parte del Marketplace**. Non introdurre nuovi `context-workspace-inspector*`, `workspace-sidecar*` o equivalenti con altro nome.

Il Semantic Graph non viene incorporato in un sidecar dell'Item: l'Item naviga al workspace canonico del grafo, preservando il proprio draft e il ritorno al contesto. Dentro il graph workspace, soltanto i task bounded — scelta soggetto, classificazione, scelta/modifica relazione — usano Task Modal.

I contract test richiedono zero consumer di:

- inspector laterali;
- sidecar sovrapposti;
- `confirmation-panel` inline;
- shell `context-task-modal*` legacy;
- `<details>` usati come surface di creazione applicativa.

## 3. Contratto di dismiss

Ogni modal applicativo usa il lifecycle condiviso basato su `LayerManager`.

- `Escape`, pulsante X, backdrop e pulsante Annulla convergono sulla stessa richiesta non distruttiva di dismiss.
- `Escape` non conferma mai un'operazione positiva o distruttiva.
- In un dialog `Scarta modifiche / Continua a modificare`, `Escape` equivale a `Continua a modificare`.
- Se il task è dirty, il consumer può intercettare la richiesta e aprire un Action Dialog prima di chiudere.
- Se un commit applicativo non è interrompibile, `canDismiss` blocca temporaneamente il dismiss.
- Con più layer, solo il layer superiore gestisce `Escape`.
- Alla chiusura il focus torna al trigger che ha aperto la surface.
- Per custom element che rerenderizzano un layer portalled, il launcher originale viene conservato attraverso i rerender e ripristinato soltanto quando il flow termina realmente.

Gli eventi custom emessi da componenti spostati sotto `document.body` devono essere inoltrati esplicitamente al loro owner quando il portal interrompe il normale bubbling del custom element. È il caso, per esempio, dei picker semantici usati nel Semantic Graph e nella Venue.

## 4. Scroll contract

Un Task Modal ha un solo application-level scroll owner verticale.

- backdrop/layer: `overflow: hidden`;
- modal panel: `overflow: hidden`;
- header: non scrollabile;
- body: `min-height: 0; overflow-y: auto`;
- footer: non scrollabile.

Liste e griglie contenute nel body non devono introdurre `max-height + overflow-y:auto`: devono scorrere con il body della surface. Textarea, select, canvas e controlli autonomi possono possedere scrolling intrinseco.

Su viewport strette il Task Modal può diventare full-height; il modello di scrolling non cambia.

Il Venue Spatial Editor è una eccezione **semantica**, non un Task Modal: è un workspace-modal lungo. In quel caso il frame specializzato è l'unico scroll owner verticale e usa `100dvh`, safe-area e `overscroll-behavior: contain`.

## 5. Responsive acceptance

Il Marketplace è desktop-first ma deve restare utilizzabile su device mobili. Le interaction surface vengono quindi verificate almeno alle seguenti dimensioni:

- 320×568;
- 390×844;
- 844×390;
- 768×1024;
- 1024×768;
- 1366×768;
- 1440×900;
- 1920×1080.

Gate minimi:

- nessun overflow orizzontale del documento;
- modal contenuto nel viewport;
- un solo scroll owner verticale applicativo;
- pagina sottostante bloccata durante il modal;
- focus iniziale, Tab/Shift+Tab, Escape e restore-focus funzionanti;
- CTA e campi raggiungibili anche con viewport bassa/landscape;
- resize non deve introdurre layout irraggiungibili;
- il restore-focus resta corretto anche dopo rerender del modal portalled.

## 6. Mapping applicativo attuale

La migrazione è stata applicata in modo coerente ai principali flussi Marketplace:

- creazione Venue e Collection → Task Modal a due passi;
- creazione Namespace e Physical Vocabulary personali/organizzazione → Task Modal condiviso;
- membri e ruoli Organization → Task Modal; azioni Owner/rimozioni → Action Dialog;
- scelta, creazione e modifica Content Space → Task Modal; destinazione fork → resource-selection Task Modal;
- creazione Offer → Task Modal a due passi con `offerConfiguration` backend-authoritative;
- acquisizione licenza → Rich Action Dialog;
- ritiro Offer/Listing → Action Dialog;
- `request_changes` di Collection, Workspace resource, Venue e Physical Vocabulary → Message Action Dialog;
- rimozioni Workspace/Venue e modifiche distruttive della configurazione fisica → Action Dialog con eventuale preflight di impatto;
- uscita dirty e `Salva e controlla` del Namespace → Action Dialog diretto dal full-page editor, senza `confirmation-panel` o stato di conferma parallelo;
- Physical Vocabulary starter → Task Modal, mentre il tutorial resta una guided overlay specializzata;
- Source Manager della Collection → Task Modal; update/detach sorgente → Action Dialog;
- Semantic Graph → workspace full-page con Task Modal soltanto per task bounded;
- Item Semantic Sidecar → rimosso in favore della navigazione al graph workspace con focus del Subject e ritorno sicuro all'Item.

Per il launcher Item → Semantic Graph, il backend filtra le Collection per copertura del Subject **prima della paginazione**. Se il Subject è rappresentato da un Item della Collection ma non ha ancora un binding nel grafo, il workspace usa il virtual focus: aprire il grafo non materializza un `GraphSubjectBinding` né crea una revisione. Il binding nasce solo da una vera azione semantica.

## 7. Gate di regressione

I contract test devono impedire il ritorno delle vecchie surface invece di mantenere allowlist permanenti. Una nuova eccezione non va aggiunta per comodità: richiede una decisione architetturale esplicita.

Il browser acceptance verifica la shell condivisa, il contratto Escape, il dirty-discard, il focus trap, il restore-focus, il single-scroll e il comportamento responsive. I test statici verificano inoltre l'assenza delle surface legacy e i boundary specializzati del Semantic Graph e della Venue.
