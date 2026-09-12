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

### Inline editor

Usare quando la modifica è piccola, strettamente legata all'oggetto visibile e non destabilizza il layout. Filtri, preferenze persistenti e campi media contestuali possono restare inline.

### Full-page / workspace editor

Usare per authoring lungo, iterativo, grafi, mappe o attività in cui il confronto continuo con il contesto è parte del lavoro.

## 2. Inspector e sidecar

Inspector laterali e sidecar sovrapposti non fanno parte della direzione futura del Marketplace. I consumer legacy vengono migrati verso Task Modal o workspace dedicati in base alla semantica del task. Non introdurre nuovi `context-workspace-inspector*` o `workspace-sidecar*`.

Il Semantic Graph non deve essere incorporato in un sidecar dell'Item: l'Item deve navigare al workspace canonico del grafo, preservando il proprio draft e il ritorno al contesto.

## 3. Contratto di dismiss

Ogni modal applicativo usa il lifecycle condiviso.

- `Escape`, pulsante X, backdrop e pulsante Annulla convergono sulla stessa richiesta non distruttiva di dismiss.
- `Escape` non conferma mai un'operazione positiva o distruttiva.
- In un dialog `Scarta modifiche / Continua a modificare`, `Escape` equivale a `Continua a modificare`.
- Se il task è dirty, il consumer può intercettare la richiesta e aprire un Action Dialog prima di chiudere.
- Se un commit applicativo non è interrompibile, `canDismiss` può bloccare temporaneamente il dismiss.
- Con più layer, solo il layer superiore gestisce `Escape`.
- Alla chiusura il focus torna al trigger che ha aperto la surface.

## 4. Scroll contract

Un Task Modal deve avere un solo application-level scroll owner verticale.

- backdrop/layer: `overflow: hidden`;
- modal panel: `overflow: hidden`;
- header: non scrollabile;
- body: `min-height: 0; overflow-y: auto`;
- footer: non scrollabile.

Textarea, select e canvas possono possedere scrolling interno perché sono controlli autonomi, ma non deve esistere una seconda scrollbar verticale della surface.

Su viewport strette il Task Modal può diventare full-height; il modello di scrolling non cambia.

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
- resize non deve introdurre layout irraggiungibili.

## 6. Migrazione

Le surface legacy sono inventariate da contract test. Le allowlist possono soltanto restringersi mentre i consumer vengono migrati. Non aggiungere nuovi consumer alle allowlist per aggirare il contratto: una nuova eccezione richiede una decisione architetturale esplicita.

Ordine approvato:

1. interaction foundation e browser responsive gates;
2. retrofit dei modal esistenti;
3. rimozione dell'Item Semantic Sidecar;
4. creazione risorse account/organization;
5. membri e ruoli;
6. Content Space e destinazioni fork;
7. Commerce;
8. workflow con messaggio;
9. destructive flows Venue/Workspace/Physical;
10. audit finale dei casi secondari e rimozione CSS/state legacy.
