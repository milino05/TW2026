# Visit authoring — selezione contenuti e collocazione fisica

Stato: **DECISIONE approvata**.

Questa decisione sostituisce, limitatamente allo step **Costruisci la visita**, la precedente formulazione in `client-architecture-decisions.md` che descriveva un composer permanentemente diviso fra ricerca a sinistra e sequenza a destra. Restano validi il workflow a cinque step, la ricerca unificata principal-scoped e tutti gli altri boundary di dominio già approvati.

## UX canonica

`Costruisci la visita` mostra come superficie primaria la sequenza corrente della Visit. La ricerca dei contenuti non occupa permanentemente lo step: la CTA **Aggiungi contenuti** apre la Task Modal condivisa del Marketplace.

Il selettore:

- mostra immediatamente una pagina dei contenuti utilizzabili dal principal proprietario della Visit;
- supporta ricerca, paginazione, filtri owned/acquired e provenienza;
- consente selezione multipla;
- riusa `createTaskDialog` e le primitive visuali `task-selection-*` / `task-resource-choice*` esistenti;
- mostra come **Già nella visita** una `ItemRevision` già presente e non consente di selezionarla nuovamente;
- non espone `ContentSource`, `EditorialRelease`, `ItemRevision` o altri identificatori tecnici come concetti user-facing.

Il principal resta un boundary netto: una Visit user-owned cerca nel workspace User; una Visit organization-owned cerca nel workspace Organization. Contenuti privati dell'altro principal non vengono aggiunti implicitamente alla ricerca.

## Invariante ContentEntry / VisitAnchor

L'aggiunta di un contenuto rappresenta sempre una scelta esplicita di una `ContentEntry`. La presenza fisica del `primarySubject` non implica automaticamente la creazione di un `VisitAnchor`.

Una stessa `ItemRevision` può comparire al massimo una volta nella stessa VisitRevision. Questo non limita il requisito di avere più contenuti sullo stesso oggetto: Item/ItemEdition/ItemRevision differenti possono condividere lo stesso `primarySubject` e restano contenuti distinti. Il comando di aggiunta rivalida l'invariante anche backend-side e rifiuta sia revisioni già presenti sia duplicati nello stesso batch.

Per ogni contenuto selezionato:

- se non esistono occurrence fisiche pubblicate e utilizzabili, il contenuto viene aggiunto come contestuale;
- se esiste almeno una occurrence, l'autore deve scegliere esplicitamente fra `contextual` e `physical`;
- in modalità `physical` deve scegliere esplicitamente il `VenueTarget` quando necessario;
- più contenuti distinti collocati sullo stesso `VenueTarget` riusano un unico `VisitAnchor`.

L'inference fisica è quindi informazione di lettura/suggerimento e non decisione editoriale.

La collocazione non è una decisione irreversibile presa al momento dell'aggiunta. Dopo l'inserimento, ogni card della `ContentEntry` espone il controllo **Collocazione**, alimentato dalle occurrence fisiche pubblicate del suo `primarySubject`. L'autore può quindi passare in qualsiasi momento da `contextual` a `physical`, da `physical` a `contextual` oppure da una occurrence fisica a un'altra senza eliminare e ricreare il contenuto.

Il cambio di collocazione modifica soltanto il delivery della `ContentEntry`:

- `contextual` imposta `deliveryAnchorId = null`;
- `physical` crea o riusa il `VisitAnchor` relativo al `VenueTarget` scelto;
- se una `ContentEntry` lascia un anchor che non è più usato da nessun altro contenuto, quell'anchor viene rimosso insieme ai `routeHints` che lo referenziano;
- se altri contenuti usano ancora lo stesso anchor, la tappa resta nella visita.

Di conseguenza una sequenza come `Gioconda: tappa → contestuale → tappa` conserva la stessa `ContentEntry`; cambiano soltanto `deliveryAnchorId` e, quando necessario, il `VisitAnchor` associato. La tappa ripristinata viene inserita nella sequenza fisica corrente come nuovo anchor; non viene mantenuto un anchor vuoto nascosto soltanto per ricordarne una posizione precedente.

`Costruisci la visita` non espone un browser autonomo di `VenueTarget` né un'azione separata "Aggiungi tappa". Le tappe sono la proiezione fisica delle scelte di collocazione dei contenuti. Una tappa già presente resta visibile e riordinabile; l'azione di rimozione della tappa rende contestuali i contenuti che vi erano associati, che possono essere nuovamente resi fisici dalle rispettive card.

## Read model

`searchVisitAuthoringCandidates` proietta per ciascun candidato `placementOptions.occurrences[]`. Le occurrence vengono risolte backend-side in batch sui Subject presenti nella pagina corrente e includono soltanto informazioni user-facing sulla Venue e sulla posizione pubblicata.

La projection della Visit applica lo stesso resolver batch ai `primarySubjectId` delle `ContentEntry` già presenti, così il controllo **Collocazione** può mostrare le alternative fisiche correnti senza un browser parallelo o query N+1. La modal riusa inoltre la stessa projection per conoscere le `ItemRevision` già incluse e disabilitarle, senza introdurre una seconda sorgente di verità.

Il client non ricostruisce autonomamente relazioni `Subject -> VenueTarget -> VenueRelease -> LayoutRevision`.

## Command contract

`POST /v2/visits/:visitId/commands/content` accetta un batch `entries[]`. Ogni entry include una scelta discriminata:

- `placement: { mode: "contextual" }`
- `placement: { mode: "physical", venueTargetId }`

Il comando rifiuta con `VISIT_CONTENT_ALREADY_INCLUDED` una `ItemRevision` già presente nella visita o ripetuta nello stesso batch.

Dopo l'aggiunta, `PUT /v2/visits/:visitId/commands/content/:contentEntryId/placement` applica la stessa scelta discriminata a una `ContentEntry` esistente. Il comando rivalida la validità corrente del target fisico, crea/riusa l'anchor necessario e ripulisce un eventuale anchor precedente diventato orfano nello stesso aggiornamento della working `VisitRevision`.

Il read model non viene trattato come autorizzazione e una Venue/Release cambiata fra lettura e conferma può causare il rifiuto autorevole del comando. Nessun comando usa errori di mutazione per scoprire occurrence, auto-seleziona la singola occurrence o restituisce stati di `inference`.

## Compatibilità futura

La separazione resta coerente con 18–27 e 18–33: contenuti privati della docente rimangono principal-scoped; QR/geolocalizzazione potranno risolvere la posizione runtime senza cambiare la semantica editoriale `ContentEntry`/`VisitAnchor`; generator e LLM potranno produrre le stesse scelte tipizzate senza introdurre un secondo modello Visit.
