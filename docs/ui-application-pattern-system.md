# ArtAround UI / Application Pattern System

Questo documento definisce le famiglie riusabili trasversali ai client ArtAround. Il principio guida è **condividere il meccanismo senza appiattire il dominio**.

## Livelli

```text
UI primitives
  -> interaction patterns
    -> application patterns
      -> domain adapters
```

Marketplace (Web Components/JavaScript) e Navigator (Vue/TypeScript) mantengono renderer idiomatici differenti. I contratti comportamentali restano però equivalenti e vengono protetti da contract test cross-client.

## Invarianti

1. Il backend resta autorevole su capability, `availableOperations[]`, transizioni e precondizioni di dominio.
2. Un `OperationDescriptor` può soltanto arricchire un'operazione già proiettata dal backend con label/intent/comportamento di presentazione. Non può sintetizzare operazioni mancanti.
3. `UiCommandRunner` coordina solo il lifecycle UI: deduplicazione, pending, error, refresh della projection, feedback transiente esplicitamente configurato.
4. Errori persistenti, blocker, issue e field feedback non vengono trasformati automaticamente in toast dal command runner.
5. Conferme distruttive usano l'Action Dialog globale salvo i casi che richiedono contenuti specializzati (impact analysis, acknowledgement, domain forms). Anche tali casi possono riusare il lifecycle del destructive flow.
6. I componenti generici non contengono repository calls o regole Item/Visit/Venue/Namespace.
7. Layer globali devono restare fuori dagli stacking context locali; nessun nuovo overlay applicativo può inventare z-index arbitrari o usare il browser top layer senza revisione del contratto di layering.

## Pattern fondazionali

### UiCommandRunner

Contratto condiviso Marketplace/Navigator:

```text
idle -> pending -> success
               \-> failure
```

Per una stessa `key`, un secondo submit mentre il primo è pending riusa la stessa Promise e non invoca nuovamente il repository. Il caller fornisce gli hook di stato e decide quale feedback mostrare.

### OperationDescriptor

Input obbligatorio: una operation backend esistente. Output: la stessa operation con un oggetto `presentation` che descrive `kind`, `intent`, `label`, `requiresMessage`.

`requiresMessage` viene preservato dalla projection backend; il frontend non lo usa per inventare transizioni.

### RevisionWorkflowControls

Mostra stato revisione, integrità e sole operation backend appartenenti al workflow. Il componente emette l'operation selezionata ma non la esegue e non decide se sia consentita.

### DestructiveActionFlow

Sequenza condivisa:

```text
request -> confirmation -> command pending -> refresh -> feedback/result
```

Il dominio fornisce titolo, conseguenze, eventuale impact check/acknowledgement e callback repository.

### AsyncBoundary

Normalizza i quattro stati di caricamento:

```text
loading -> Progress
error   -> Callout danger
empty   -> Empty State
ready   -> domain content
```

## Pattern successivi

Le astrazioni successive usano lo stesso criterio:

- `AuthoringStepper`: navigazione/accessibilità/stato del wizard, non validazione di Item o Visit;
- `ResourceBrowserShell` + `QueryState`: ricerca/filtri/paginazione locali, non query di dominio;
- `LayerManager`: mount globale, gerarchia, scroll/focus/Escape;
- `FormField`: label/help/required/error/ARIA attorno al controllo;
- `ActionMenu`: tastiera/focus/outside-click/viewport/layer;
- `GuidedTour`: step/target/progress/persistenza, con contenuti forniti dall'editor;
- `ReorderableList`: DnD + fallback accessibile, con validità dello spostamento delegata al dominio;
- `MediaField` / `MediaViewer`: selezione/preview/progress/replace/remove, senza unificare i modelli media;
- `SearchController`: query/debounce/loading/retry/selection, con provider/semantica specifici;
- `StatusRegistry`: label/tone namespaced (`revision`, `integrity`, `session`, `listing`) per evitare ambiguità di stati come `active`.

## Non-obiettivi

Non vengono introdotti un Universal Resource Editor, un generic publish che confonda publication editoriale e commercio, o un modello media unico. `EditorialRelease`, revision workflow, Listing/Offer, Visit runtime e Venue spatial authoring restano lifecycle/domain distinti.
