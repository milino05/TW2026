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
- non espone `ContentSource`, `EditorialRelease`, `ItemRevision` o altri identificatori tecnici come concetti user-facing.

Il principal resta un boundary netto: una Visit user-owned cerca nel workspace User; una Visit organization-owned cerca nel workspace Organization. Contenuti privati dell'altro principal non vengono aggiunti implicitamente alla ricerca.

## Invariante ContentEntry / VisitAnchor

L'aggiunta di un contenuto rappresenta sempre una scelta esplicita di una `ContentEntry`. La presenza fisica del `primarySubject` non implica automaticamente la creazione di un `VisitAnchor`.

Per ogni contenuto selezionato:

- se non esistono occurrence fisiche pubblicate e utilizzabili, il contenuto viene aggiunto come contestuale;
- se esiste almeno una occurrence, l'autore deve scegliere esplicitamente fra `contextual` e `physical`;
- in modalità `physical` deve scegliere esplicitamente il `VenueTarget` quando necessario;
- più contenuti collocati sullo stesso `VenueTarget` riusano un unico `VisitAnchor`.

L'inference fisica è quindi informazione di lettura/suggerimento e non decisione editoriale.

## Read model

`searchVisitAuthoringCandidates` proietta per ciascun candidato `placementOptions.occurrences[]`. Le occurrence vengono risolte backend-side in batch sui Subject presenti nella pagina corrente e includono soltanto informazioni user-facing sulla Venue e sulla posizione pubblicata.

Il client non ricostruisce autonomamente relazioni `Subject -> VenueTarget -> VenueRelease -> LayoutRevision`.

## Command contract

`POST /v2/visits/:visitId/commands/content` accetta un batch `entries[]`. Ogni entry include una scelta discriminata:

- `placement: { mode: "contextual" }`
- `placement: { mode: "physical", venueTargetId }`

Il comando rivalida authorization del contenuto e validità corrente del target fisico. Il read model non viene trattato come autorizzazione e una Venue/Release cambiata fra lettura e conferma può causare il rifiuto autorevole del comando.

Il comando applica il batch con un solo aggiornamento della working `VisitRevision`. Non usa errori di mutazione per scoprire occurrence, non auto-seleziona la singola occurrence e non restituisce stati di `inference`.

## Compatibilità futura

La separazione resta coerente con 18–27 e 18–33: contenuti privati della docente rimangono principal-scoped; QR/geolocalizzazione potranno risolvere la posizione runtime senza cambiare la semantica editoriale `ContentEntry`/`VisitAnchor`; generator e LLM potranno produrre le stesse scelte tipizzate senza introdurre un secondo modello Visit.
