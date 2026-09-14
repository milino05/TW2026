# Navigator runtime — decisioni architetturali approvate

Stato: **DECISIONE approvata**.

Questo documento dettaglia il runtime fisico del Navigator e integra `docs/client-architecture-decisions.md`. In caso di conflitto valgono specifiche ufficiali, decisioni più recenti esplicitamente approvate e stato verificato su `main`.

## 1. Piano, progressione narrativa e posizione fisica sono separati

`SessionPlanRevisionV2` resta il piano pinzato della visita: ContentEntry, VisitAnchor e percorso fisico pianificato. `currentEntryIndex` resta il cursore narrativo. La posizione fisica non viene dedotta dal cursore narrativo durante l'esecuzione live.

La `VisitSessionV2` personale mantiene `physicalRuntime.knownLocation` come ultima posizione che il sistema può giustificare e un'eventuale `physicalRuntime.detour`. La route live e la fase di esecuzione sono derivate e non vengono duplicate in MongoDB.

## 2. Tappa

Una Tappa è un `VisitAnchor` con il gruppo di ContentEntry consegnate tramite lo stesso `deliveryAnchorId`. Più contenuti, anche concettuali, possono quindi appartenere alla stessa Tappa. Una ContentEntry realmente indipendente dalla posizione usa `deliveryAnchorId = null`.

Se l'utente seleziona esplicitamente una Tappa precedente, il cursore narrativo viene spostato alla prima ContentEntry di quella Tappa. La posizione fisica e lo storico non vengono riscritti. Per esempio Tappa 5 → Tappa 3 produce poi la progressione ordinaria 3 → 4 → 5 → 6.

Una ContentEntry con `deliveryAnchorId = null` resta immediatamente presentabile anche se la stessa visita contiene altre Tappe fisiche: l'esistenza di VisitAnchor altrove nel piano non introduce implicitamente un gate di posizione. L'utente può comunque confermare facoltativamente la propria posizione per usare orientamento e facility.

## 3. KnownLocation

`knownLocation` contiene riferimenti fisici pinzati (`venueId`, `placeId` e, quando noti, `visitAnchorId`, `venueTargetId`, `exhibitSlotId`) e provenance della conoscenza (`manual_selection`, `navigation_confirmation`, `qr`, `teleport`, `geolocation`).

Il runtime non sostiene che `knownLocation` sia una misura GPS: è l'ultima posizione accettata dal sistema. L'utente può correggerla esplicitamente. I provider 18–33 alimenteranno lo stesso concetto senza cambiare la macchina a stati.

La **selezione manuale sulla mappa è evidenza place-level**: conferma `venueId + placeId`, ma non prova da sola che l'utente abbia identificato un determinato VisitAnchor, VenueTarget o ExhibitSlot. L'identificazione esatta dell'oggetto deriva dall'approach confermato oppure da provider che possano fornire un'evidenza più forte, come QR/teleport/geolocation quando configurati a tale scopo.

## 4. Route live derivata

Il backend riusa il routing esistente e lo snapshot fisico pinzato. La route live viene ricalcolata da `knownLocation + destination` e non viene persistita. `progress.next` durante la navigazione conferma il primo passo della route corrente e aggiorna la KnownLocation; non avanza il cursore narrativo.

La route pianificata nel SessionPlan e la route live restano concetti diversi.

Un trasferimento inter-Venue viene eseguito soltanto se esiste la corrispondente leg `inter_venue` nel SessionPlan. L'origine può essere provata da un VisitAnchor esatto oppure dalla presenza place-level nell'area dell'anchor sorgente; non è necessario fingere di aver identificato l'opera precedente per iniziare un trasferimento già pianificato.

## 5. Approach e presentation gate

Essere nel `placeId` corretto significa essere arrivati nell'area e porta ad `approaching_visit_target`. La Representation si sblocca solo quando la KnownLocation identifica il VisitAnchor o l'ExhibitSlot di destinazione. I contenuti della stessa Tappa possono quindi susseguirsi senza nuova macro-navigazione.

Il gate vale fin dalla risposta pubblica di start: `ExecutionPreparation.start` deve restituire la stessa `currentNavigatorRuntimeProjection` usata da `GET /current`, così una nuova sessione non può esporre la Representation prima della conferma fisica soltanto perché è stata appena materializzata.

## 6. Deviazioni fisiche

Una deviazione verso toilette, uscita, bar, shop o altra facility non modifica `currentEntryIndex`. Viene persistita soltanto la destinazione concreta risolta. `Torna alla visita` elimina la deviazione e il backend ricalcola il percorso dalla KnownLocation al target narrativo corrente. È ammessa una sola deviazione attiva; una nuova destinazione sostituisce la precedente.

La deviazione fisica è distinta da `semanticPresentation` e `semantic.return`.

`Torna alla visita` deve essere disponibile durante tutta la deviazione, non soltanto dopo l'arrivo. L'utente può quindi cambiare idea mentre sta raggiungendo una facility, oppure scegliere una nuova facility: in quel caso la nuova destinazione sostituisce la deviazione precedente e la route live viene ricalcolata dalla KnownLocation corrente.

## 7. Visite sincronizzate

Il piano e la progressione narrativa appartengono alla `SynchronizedVisitSession`; `knownLocation`, deviazioni, presentation override ed esplorazioni semantiche restano personali nella `VisitSessionV2` di ciascun partecipante. Il partecipante non riceve next/previous narrativi, ma può confermare personalmente i passi fisici. Il playback condiviso della guida resta autorevole per la presentazione comune.

Gli owner runtime sono espliciti:

- `planOwner`: possiede il `SessionPlanRevisionV2` corrente;
- `progressOwner`: possiede cursore narrativo, stato di avanzamento e relativa `runtimeVersion`;
- `routingConfigurationOwner`: possiede venue pin, navigation snapshot e velocità/configurazione di routing;
- `physicalRuntimeOwner`: è sempre la `VisitSessionV2` personale e possiede KnownLocation e deviazioni.

In self-guided i quattro ruoli coincidono con la VisitSession. In synchronized i primi tre ruoli appartengono alla `SynchronizedVisitSession`, mentre `physicalRuntimeOwner` resta personale. Il vecchio concetto ambiguo `physicalSession` non fa parte del contratto runtime.

## 8. Runtime derivato

Le fasi canoniche sono:

- `location_required`
- `navigating_to_visit_stop`
- `approaching_visit_target`
- `presenting_visit_content`
- `presenting_semantic_content`
- `navigating_detour`
- `at_detour_destination`
- `route_completed`

La fase è una projection derivata e non un campo persistente. `location_required` si applica quando la ContentEntry narrativa corrente richiede un delivery anchor e non esiste ancora una KnownLocation sufficiente per avviare il routing; non blocca le ContentEntry realmente location-independent.

## 9. Boundary

Le mutazioni runtime continuano a passare dal protocollo Action e da `POST /v2/visit-sessions/:sessionId/actions`. Le API `current` e `map` restano read projection. I resolver di location, incluso il public-code resolver, non spostano implicitamente la Session.

Le action che richiedono un parametro concreto (`location.confirm`, `location.correct`, `visit.stop.select`) vengono materializzate dalla UI attraverso Mappa/Tappe e inviate al medesimo ActionDispatcher soltanto dopo la scelta dell'utente.

La `MapProjection` runtime espone un solo contratto canonico:

- `narrativeContextStop` per il contesto narrativo corrente;
- `knownLocation` per la posizione fisica giustificata;
- `plannedVisitRoute` per il percorso pinzato/pianificato;
- `activeNavigation` per la route live derivata.

I vecchi campi top-level `logicalCurrentStop`, `plannedLegs` e `interVenueTransitions` non fanno parte della projection Navigator runtime. I dati pianificati vivono esclusivamente sotto `plannedVisitRoute`.

Le facility mostrate sulla mappa non introducono comandi UI paralleli: il marker o il controllo diventa azionabile solo quando esiste la corrispondente `AvailableAction navigation.place.*` già autorizzata dal backend e la UI inoltra quella stessa action all'ActionDispatcher. La regola vale sia in self-guided sia in synchronized; in synchronized la deviazione resta `visit_session`-scoped e quindi personale.

## 10. Principio di riuso

Il runtime deve riusare `PhysicalFeatureRefSchema`, lo snapshot fisico pinzato, `loadPinnedBundle`, la traduzione dei routing requirement e il routing graph esistenti. Non vengono introdotti un secondo routing engine, una seconda action infrastructure o copie persistite della route.

## 11. Tracciabilità rispetto all'architettura client-v2

Questo documento è l'addendum runtime fisico delle decisioni client-v2 raccolte in `docs/client-architecture-decisions.md`: ne specializza il protocollo Action, il runtime server-side e la predisposizione 18–27/18–33 senza riaprire i Punti 1–30. Le decisioni di questo addendum sono quindi parte della stessa architettura approvata, non una linea progettuale parallela.

I contract test dedicati devono impedire regressioni almeno sui seguenti boundary: start fisicamente gated, assenza dei campi MapProjection legacy, azioni facility della mappa instradate tramite `AvailableAction` in entrambe le modalità, separazione progressione/posizione e ownership synchronized.

## 12. Superfici UX: Visita, Mappa e voce

Le superfici visuali separano i due domini senza duplicare le action:

- **Visita** presenta contenuto, adattamenti di Presentation, esplorazione semantica e lifecycle della sessione;
- **Mappa** presenta posizione confermata, route live, destinazione corrente, facility, correzione posizione, ritorno dalla deviazione e avanzamento fisico;
- la **voce controllata** continua a usare l'intero insieme delle `AvailableAction` consentite nel contesto corrente, quindi può attivare sia azioni narrative sia fisiche senza introdurre un secondo vocabolario autorizzativo.

La separazione è di presentation layer: authorization, action identity, runtime scope e dispatch restano backend-authoritative.

## 13. `progress.next`: identità stabile e ruolo UI esplicito

`progress.next` resta l'unico `actionId` canonico per l'avanzamento contestuale. Non vengono creati `physical.next` e `narrative.next` paralleli.

Per consentire alla UI di collocare il comando nella superficie corretta senza inferire la semantica dalla fase, la projection pubblica distingue il ruolo:

- `type = PROGRESS_NEXT` per l'avanzamento narrativo;
- `type = PHYSICAL_PROGRESS_NEXT` quando lo stesso `actionId = progress.next` è materializzato con `serverInput.executionMode = physical`.

Il tipo pubblico è quindi un discriminatore di presentazione, non una nuova ActionDefinition né un nuovo comando del dispatcher. Runtime scope e `runtimeVersion` restano invariati. In synchronized il partecipante può ricevere soltanto il progress fisico personale; la guida può ricevere il progress narrativo di gruppo. Quando il playback condiviso rende ambiguo lo stesso `actionId`, resta valida la policy già approvata che privilegia il progress narrativo di gruppo e sopprime temporaneamente quello fisico personale della guida.

Nella fase `approaching_visit_target` il controllo fisico viene presentato come **“Trovata!”**; durante il percorso viene presentato sulla Mappa come conferma dell'indicazione completata.

## 14. Mappa operativa durante l'esecuzione

Durante una navigazione attiva la Mappa mostra soltanto ciò che serve alla decisione fisica corrente:

- ultima KnownLocation confermata;
- destinazione corrente;
- geometria della sola `activeNavigation` residua;
- controlli fisici applicabili.

Il percorso pianificato completo e i marker permanenti di tutte le tappe non vengono sovrapposti alla planimetria durante l'esecuzione. `plannedVisitRoute` resta disponibile nella projection come dato pianificato e per usi diagnostici/contestuali, ma non viene confuso con il percorso live.

Poiché `activeNavigation` viene derivata nuovamente dopo ogni conferma fisica, il tratto già percorso scompare naturalmente: il client non mantiene uno storico grafico locale e non ritaglia manualmente la polyline.

Il percorso live usa un'evidenza visiva più forte della cartografia di sfondo; posizione e destinazione restano distinguibili anche senza affidarsi soltanto al colore.

## 15. Recognition media e illustrative media

Le immagini usate per **riconoscere fisicamente l'opera** sono un dominio diverso dalle immagini editoriali mostrate insieme al contenuto.

La schermata `approaching_visit_target` risolve la recognition con questa precedence:

1. `VenueTarget.targetBinding.recognitionMedia` della Venue pinzata, quando disponibile;
2. `Item.recognitionMedia` come fallback generico dell'oggetto;
3. nessuna immagine.

`ItemRevision.illustrativeMedia` non è un fallback di recognition e non viene usata per sbloccare o identificare fisicamente un VisitAnchor.

Nel Marketplace/Editor:

- `Item.recognitionMedia` si modifica nel dettaglio dell'Item ed è la recognition generica cross-Venue;
- la recognition specifica di una Venue si gestisce nella presenza/inventario fisico della Venue;
- `ItemRevision.illustrativeMedia` si modifica nell'authoring della versione editoriale come **Immagine del contenuto**.

La creazione di una nuova Edition non copia automaticamente `Item.recognitionMedia` dentro `illustrativeMedia`. Un'eventuale proposta editoriale da Wikidata viene risolta come scelta indipendente della Revision.

## 16. Preparation, tema e timing

Le preference di Presentation e routing della preparation restano backend-authoritative. Il client può applicarle con debounce per rendere il riepilogo reattivo, ma ogni nuova stima di `contentSeconds`, `travelSeconds`, readiness e route deriva da una nuova projection backend.

Il riepilogo mostra una durata sufficientemente precisa da rendere visibili cambiamenti inferiori al minuto. I controlli della preparation devono usare i token `--navigator-*` anche in dark mode e non assumere superfici chiare hardcoded.

Nella modalità synchronized le preference narrative personali dell'host non alterano la baseline editoriale condivisa; le esigenze fisiche e le opzioni di routing dell'host continuano invece a determinare il percorso condiviso secondo il contratto della preparation sincronizzata.
