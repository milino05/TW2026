# Navigator runtime — decisioni architetturali approvate

Stato: **DECISIONE approvata**.

Questo documento dettaglia il runtime fisico del Navigator e integra `docs/client-architecture-decisions.md`. In caso di conflitto valgono specifiche ufficiali, decisioni più recenti esplicitamente approvate e stato verificato su `main`.

## 1. Piano, progressione narrativa e posizione fisica sono separati

`SessionPlanRevisionV2` resta il piano pinzato della visita: ContentEntry, VisitAnchor e percorso fisico pianificato. `currentEntryIndex` resta il cursore narrativo. La posizione fisica non viene dedotta dal cursore narrativo durante l'esecuzione live.

La `VisitSessionV2` personale mantiene `physicalRuntime.knownLocation` come ultima posizione che il sistema può giustificare e un'eventuale `physicalRuntime.detour`. La route live e la fase di esecuzione sono derivate e non vengono duplicate in MongoDB.

## 2. Tappa

Una Tappa è un `VisitAnchor` con il gruppo di ContentEntry consegnate tramite lo stesso `deliveryAnchorId`. Più contenuti, anche concettuali, possono quindi appartenere alla stessa Tappa. Una ContentEntry realmente indipendente dalla posizione usa `deliveryAnchorId = null`.

Se l'utente seleziona esplicitamente una Tappa precedente, il cursore narrativo viene spostato alla prima ContentEntry di quella Tappa. La posizione fisica e lo storico non vengono riscritti. Per esempio Tappa 5 → Tappa 3 produce poi la progressione ordinaria 3 → 4 → 5 → 6.

## 3. KnownLocation

`knownLocation` contiene riferimenti fisici pinzati (`venueId`, `placeId` e, quando noti, `visitAnchorId`, `venueTargetId`, `exhibitSlotId`) e provenance della conoscenza (`manual_selection`, `navigation_confirmation`, `qr`, `teleport`, `geolocation`).

Il runtime non sostiene che `knownLocation` sia una misura GPS: è l'ultima posizione accettata dal sistema. L'utente può correggerla esplicitamente. I provider 18–33 alimenteranno lo stesso concetto senza cambiare la macchina a stati.

## 4. Route live derivata

Il backend riusa il routing esistente e lo snapshot fisico pinzato. La route live viene ricalcolata da `knownLocation + destination` e non viene persistita. `progress.next` durante la navigazione conferma il primo passo della route corrente e aggiorna la KnownLocation; non avanza il cursore narrativo.

La route pianificata nel SessionPlan e la route live restano concetti diversi.

## 5. Approach e presentation gate

Essere nel `placeId` corretto significa essere arrivati nell'area e porta ad `approaching_visit_target`. La Representation si sblocca solo quando la KnownLocation identifica il VisitAnchor o l'ExhibitSlot di destinazione. I contenuti della stessa Tappa possono quindi susseguirsi senza nuova macro-navigazione.

## 6. Deviazioni fisiche

Una deviazione verso toilette, uscita, bar, shop o altra facility non modifica `currentEntryIndex`. Viene persistita soltanto la destinazione concreta risolta. `Torna alla visita` elimina la deviazione e il backend ricalcola il percorso dalla KnownLocation al target narrativo corrente. È ammessa una sola deviazione attiva; una nuova destinazione sostituisce la precedente.

La deviazione fisica è distinta da `semanticPresentation` e `semantic.return`.

## 7. Visite sincronizzate

Il piano e la progressione narrativa appartengono alla `SynchronizedVisitSession`; `knownLocation`, deviazioni, presentation override ed esplorazioni semantiche restano personali nella `VisitSessionV2` di ciascun partecipante. Il partecipante non riceve next/previous narrativi, ma può confermare personalmente i passi fisici. Il playback condiviso della guida resta autorevole per la presentazione comune.

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

La fase è una projection derivata e non un campo persistente.

## 9. Boundary

Le mutazioni runtime continuano a passare dal protocollo Action e da `POST /v2/visit-sessions/:sessionId/actions`. Le API `current` e `map` restano read projection. I resolver di location, incluso il public-code resolver, non spostano implicitamente la Session.

## 10. Principio di riuso

Il runtime deve riusare `PhysicalFeatureRefSchema`, lo snapshot fisico pinzato, `loadPinnedBundle`, la traduzione dei routing requirement e il routing graph esistenti. Non vengono introdotti un secondo routing engine, una seconda action infrastructure o copie persistite della route.
