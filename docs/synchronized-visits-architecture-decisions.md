# ArtAround — Decisioni architetturali visite sincronizzate 18–27

Questo documento raccoglie le decisioni **approvate** relative alle visite sincronizzate richieste dalla fascia 18–27 del progetto ArtAround.

È un registro feature-specifico. Le decisioni generali già fissate in `docs/client-architecture-decisions.md`, `docs/domain-model-v2.md` e negli altri documenti architetturali restano valide; questo documento le specializza per il sottosistema di sincronizzazione. In caso di conflitto valgono, nell'ordine, specifiche ufficiali, decisioni più recenti esplicitamente approvate e stato implementato verificato su `main`.

La revisione del 13 settembre 2026 sostituisce esplicitamente la precedente scelta che modellava `deliveryMode` nella `VisitRevision`. La motivazione è separare in modo coerente l'identità editoriale della visita dalla modalità con cui una singola esecuzione viene avviata nel Navigator.

# Principio di dominio

ArtAround separa quattro responsabilità:

```text
Visit / VisitRevision        = che cosa viene visitato
Presentation                = come il contenuto viene presentato
Navigation / physical plan  = dove e come ci si sposta
Execution runtime           = con chi e con quale autorità si esegue la visita
```

Una Visit non è quindi "autonoma" o "sincronizzata". La stessa revisione pubblicata può essere eseguita personalmente oppure, quando supportato, come sessione di gruppo senza essere modificata o ripubblicata.

# Decisioni approvate

## SV-01 — La modalità appartiene all'esecuzione, non alla VisitRevision

`VisitV2` resta l'identità editoriale e `VisitRevisionV2` contiene struttura, contenuti, tappe, baseline di presentazione, logistica e configurazioni editoriali opzionali. Non contiene `deliveryMode` né un flag equivalente.

La modalità viene scelta nel Navigator e pinzata in `ExecutionPreparation.executionMode`:

```text
self_guided | synchronized
```

La preparation è il boundary corretto perché la modalità influenza già la costruzione del piano iniziale: un'esecuzione personale può materializzare le preferenze esplicite dell'utente nel proprio piano, mentre una sessione di gruppo deve costruire un piano strutturale condiviso preservando la baseline editoriale comune.

## SV-02 — Un solo workflow di authoring, senza classificazione della visita

Il workflow canonico resta **Informazioni principali → Costruisci la visita → Impostazioni → Percorso → Pubblicazione**.

Il Marketplace non presenta più un toggle "Visita sincronizzata" e non crea un wizard separato. L'autore può predisporre facoltativamente:

- un nome mnemonico suggerito per future sessioni di gruppo;
- un quiz finale.

Queste feature non cambiano il tipo della Visit e non sono prerequisiti per eseguirla in gruppo.

## SV-03 — Alias editoriale suggerito, alias richiesto e alias runtime sono distinti

L'alias mnemonico continua a essere l'interfaccia primaria con cui i partecipanti entrano. Vengono però distinti tre livelli:

```text
VisitRevision.groupSessionDefaults.preferredJoinAlias
    default editoriale facoltativo

ExecutionPreparation.groupSessionSetup.requestedJoinAlias
    nome richiesto dalla guida per quella esecuzione

SynchronizedVisitSession.joinAlias
    nome effettivamente assegnato al runtime
```

Se la guida non fornisce un nome, la preparation usa nell'ordine il default editoriale, il titolo della visita e un fallback leggibile. Mongo ID, UUID e codici tecnici non sono l'interfaccia primaria di ingresso.

## SV-04 — La guida sceglie la modalità nel Navigator prima dello start

L'apertura della pagina di preparazione crea una `ExecutionPreparation`. Il Navigator permette alla guida di scegliere **Personale** oppure **Di gruppo**. Il cambio di modalità aggiorna la stessa preparation e ricalcola piano, readiness e logistica; non crea ancora alcuna sessione.

Solo `POST /v2/execution-preparations/:id/start` consuma la preparation e crea il runtime appropriato.

## SV-05 — Aggregate runtime di gruppo separato dalle VisitSession personali

La sincronizzazione usa `SynchronizedVisitSession` come aggregate runtime superiore, con almeno `visitId`, `visitRevisionId`, `hostUserId`, `joinAlias`, `status`, `currentEntryIndex`, `runtimeVersion`, piano condiviso, stato playback e timestamp.

`SynchronizedVisitSession` non sostituisce `VisitSessionV2`: host e partecipanti continuano ad avere una propria sessione personale collegata al gruppo.

## SV-06 — Si sincronizza il punto della visita, non la Representation

Il gruppo condivide il `ContentEntry` corrente e il piano strutturale. La singola `VisitSessionV2` determina invece come quel contenuto viene presentato al partecipante. Due utenti sulla stessa tappa possono quindi ricevere Representation differenti per profondità, complessità o lingua senza spostare il gruppo.

## SV-07 — La guida controlla la progressione globale

L'host è l'autorità sulla progressione comune. I participant non ricevono azioni di avanzamento globale. La policy resta backend-authoritative tramite `AvailableAction[]`; il client non implementa la sicurezza limitandosi a nascondere pulsanti.

## SV-08 — Gli adattamenti individuali restano personali

Azioni di presentazione e approfondimento semantico modificano soltanto la `VisitSessionV2` del singolo utente e non alterano `SynchronizedVisitSession.currentEntryIndex`, il piano condiviso o l'esperienza degli altri partecipanti.

## SV-09 — Lobby semplice e controllo dei partecipanti

Lo start in modalità `synchronized` crea una lobby. La guida vede alias effettivo, partecipanti entrati e azioni per iniziare o annullare. Il participant entra con il solo alias mnemonico e vede uno stato di attesa semplice fino all'avvio.

## SV-10 — Il Navigator resta unico

Non esistono Navigator separati per guida e partecipante. Lo stesso client riceve projection e azioni differenti in base a ruolo, membership e stato runtime.

## SV-11 — Telemetria osservabile, non riconoscimento dell'attenzione

Lo stato di fruizione viene derivato da eventi applicativi osservabili: avvio, playback, pausa, completamento, `completionRatio`, richieste e interazioni. Non vengono introdotti webcam, eye tracking o inferenze biometriche.

## SV-12 — Accesso temporaneo ai contenuti privati tramite membership

Una membership valida alla sessione sincronizzata concede l'autorità runtime minima necessaria a fruire la revisione pinzata e i relativi snapshot. Non pubblica contenuti, non trasferisce ownership, non crea Acquisition e non concede riuso permanente fuori dalla sessione.

## SV-13 — Snapshot stabile della VisitRevision

La `SynchronizedVisitSession` pinna una specifica `VisitRevisionV2` all'avvio. Nuove revisioni o pubblicazioni non modificano una sessione già iniziata. Tutte le sessioni personali collegate usano lo stesso piano strutturale condiviso.

## SV-14 — Realtime come invalidazione, projection come fonte autorevole

Il realtime notifica cambiamenti del runtime ma non diventa fonte primaria della business logic. Il pattern resta:

```text
command → aggiornamento backend/versione → evento realtime → refresh projection autorevole
```

## SV-15 — Runtime versionato e concorrenza esplicita

I comandi che mutano lo stato condiviso vengono validati rispetto a `runtimeVersion` o equivalente. Retry e doppie azioni non devono produrre avanzamenti multipli; un client desincronizzato recupera la projection corrente dal backend.

## SV-16 — Quiz editoriale opzionale, tentativi runtime separati

Le domande del quiz appartengono alla `VisitRevisionV2`, perché sono contenuto preparato dall'autore. Sono però **opzionali** e indipendenti da `executionMode`.

Una Visit senza quiz può essere avviata sia personalmente sia in gruppo. In una sessione sincronizzata l'azione `SYNCHRONIZED_START_QUIZ` viene esposta soltanto quando la revisione pinzata contiene domande valide.

Risposte, tentativi, stato e risultati dei partecipanti restano runtime e non vengono scritti nella revisione editoriale.

## SV-17 — Valutazione minima per 18–27

Il primo incremento mantiene un quiz semplice: multiple choice, correzione deterministica, score e riepilogo per la guida. Non vengono introdotti LMS, registri, classi permanenti o rubriche non richieste.

## SV-18 — UX participant minimalista e invariata nel refactoring

Il participant continua a seguire il flusso dedicato già esistente:

```text
Navigator → Entra in una visita → alias → lobby/sessione
```

Non sceglie `executionMode`, non seleziona la Visit da eseguire e non vede concetti Marketplace o identificatori tecnici. Join, rejoin, attesa, contenuto corrente, adattamenti personali e quiz restano nello stesso flusso.

## SV-19 — UX host orientata al controllo del gruppo

La guida sceglie nel pre-visit del Navigator se avviare personalmente o in gruppo. In modalità di gruppo può confermare/modificare il nome di ingresso prima di creare la lobby. Durante la sessione vede progressione, partecipanti, stato di fruizione osservabile, playback, eventuale quiz e chiusura.

## SV-20 — Ordine del refactoring e vertical slice

La migrazione al nuovo modello procede in modo coordinato, senza compatibility layer permanente:

1. **Dominio editoriale**: rimozione di `VisitRevision.deliveryMode` e della vecchia configurazione `synchronization`; introduzione di `groupSessionDefaults` e quiz opzionale.
2. **Preparation boundary**: `ExecutionPreparation.executionMode`, setup di gruppo e start runtime basato sulla preparation.
3. **Navigator**: scelta Personale/Di gruppo nella vista pre-visit, riuso degli endpoint e del runtime esistenti.
4. **Runtime alignment**: projection `executionMode`, quiz action condizionale, nessuna modifica al modello di membership/join/realtime salvo quanto necessario ai nuovi contratti.
5. **Dataset e test**: le stesse Visit demo predisposte per il gruppo devono poter essere eseguite anche personalmente; seed e verifiche non classificano più le Visit per modalità.

## SV-21 — I partecipanti sono normali User autenticati

Gli studenti entrano come `User` ArtAround autenticati. Non vengono introdotti guest account o identità temporanee nella prima implementazione 18–27.

## SV-22 — Membership separata dal group aggregate

`SynchronizedVisitMembership` resta un documento separato con almeno:

```text
synchronizedSessionId
userId
role: host | participant
visitSessionId
status
joinedAt
completedAt
```

La coppia `(synchronizedSessionId, userId)` è unica.

## SV-23 — Membership e presenza realtime sono concetti distinti

La perdita temporanea di rete non rimuove la membership. La presenza online/offline viene derivata dal realtime; membership e autorizzazione persistono secondo il lifecycle della sessione.

## SV-24 — Lifecycle minimale del group runtime

Il lifecycle resta:

```text
lobby → active → quiz → completed
```

con `cancelled` come stato terminale alternativo. Se la revisione non contiene quiz, l'host conclude la sessione senza transitare per `quiz`.

## SV-25 — Join e rejoin idempotenti

Il join è idempotente per `(synchronizedSessionId, userId)`. Un utente già membro che rientra tramite alias recupera membership, VisitSession personale e projection corrente senza creare duplicati.

## SV-26 — Alias runtime univoco soltanto tra sessioni joinable

`ExecutionPreparation.groupSessionSetup.requestedJoinAlias` viene normalizzato e passato al runtime. `SynchronizedVisitSession.joinAlias` conserva il valore effettivamente assegnato.

L'unicità vale soltanto tra sessioni contemporaneamente joinable (`lobby`, `active`, `quiz`). In caso di collisione il backend assegna una variante ancora leggibile, ad esempio `Fenice rossa 2`. Dopo la chiusura l'alias può essere riutilizzato.

## SV-27 — Un solo piano strutturale condiviso dal gruppo

Una sessione sincronizzata possiede un solo `SessionPlanRevisionV2` strutturale. Le `VisitSessionV2` personali non duplicano quel piano; conservano invece stato e override personali. La preparation sincronizzata materializza il piano comune senza incorporare le preferenze personali dell'host, che vengono applicate soltanto alla sua sessione individuale.

# Contratto di avvio approvato

Gli endpoint restano quelli già esistenti:

```text
POST   /v2/execution-preparations
GET    /v2/execution-preparations/:preparationId
PATCH  /v2/execution-preparations/:preparationId
POST   /v2/execution-preparations/:preparationId/start
```

Esempio personale:

```json
{
  "visitId": "...",
  "executionMode": "self_guided"
}
```

Esempio gruppo:

```json
{
  "visitId": "...",
  "executionMode": "synchronized",
  "groupSessionSetup": {
    "requestedJoinAlias": "Fenice rossa"
  }
}
```

Lo start riceve soltanto la versione attesa della preparation; non può cambiare implicitamente modalità all'ultimo momento.

# Predisposizione 18–33

Il modello mantiene `executionMode` separato dalla source. Per il livello attuale una Visit supporta `self_guided` e `synchronized`, mentre un `GeneratedVisitPlanV2` supporta soltanto `self_guided`. Il backend espone questa differenza come capability della preparation e rifiuta una modalità non supportata con un errore esplicito.

Questa è una limitazione di incremento, non un vincolo del dominio: in futuro un piano generato potrà supportare l'esecuzione sincronizzata senza introdurre `deliveryMode` nel GeneratedPlan o un secondo runtime parallelo.
