# ArtAround — Decisioni architetturali visite sincronizzate 18–27

Questo documento raccoglie le decisioni **approvate** relative alle visite sincronizzate richieste dalla fascia 18–27 del progetto ArtAround.

È un registro feature-specifico. Le decisioni generali già fissate in `docs/client-architecture-decisions.md`, `docs/domain-model-v2.md` e negli altri documenti architetturali restano valide; questo documento le specializza per il sottosistema di sincronizzazione. In caso di conflitto valgono, nell'ordine, specifiche ufficiali, decisioni più recenti esplicitamente approvate e stato implementato verificato su `main`.

Le proposte non ancora approvate non devono essere registrate qui come decisioni definitive. Ogni nuova decisione sulla sincronizzazione approvata durante la progettazione deve aggiornare questo file.

## Stato iniziale verificato su `main`

Alla data del 31 agosto 2026:

- `VisitV2` rappresenta l'identità editoriale della visita e non contiene stato runtime;
- `VisitRevisionV2` contiene struttura editoriale, contenuti, anchor, baseline di presentazione e logistica;
- `VisitSessionV2` rappresenta l'esecuzione runtime di un singolo utente e contiene già progressione, override di presentazione, esplorazione semantica, interaction events e dati di esperienza;
- il Navigator deriva le interazioni disponibili da `AvailableAction[]` backend-authoritative;
- il runtime supporta già adattamenti individuali della presentazione senza modificare il contenuto editoriale della Visit;
- il backend corrente è Node/Express/Mongoose e non dispone ancora di un trasporto realtime WebSocket/Socket.IO.

Queste caratteristiche vengono riusate: la sincronizzazione non introduce un secondo modello di Visit, un secondo Navigator o una pipeline di presentation parallela.

# Decisioni approvate

## SV-01 — Una Visit, modalità di fruizione esplicita

La visita continua a essere un unico dominio editoriale. Una `VisitRevision` dichiara però la propria modalità di fruizione tramite un valore tipizzato, concettualmente:

```text
deliveryMode = self_guided | synchronized
```

La UI può presentare questa scelta come un semplice toggle **Visita sincronizzata**, ma il dominio usa una semantica esplicita e non un insieme di flag runtime sparsi.

La modalità sincronizzata è una proprietà della revisione editoriale, mentre l'effettiva esecuzione di gruppo appartiene a una sessione runtime separata.

## SV-02 — Il workflow di authoring esistente viene preservato

Il workflow canonico resta:

**Informazioni principali → Costruisci la visita → Impostazioni → Percorso → Pubblicazione**.

L'opzione **Visita sincronizzata** viene proposta nel primo step di creazione/informazioni. Non viene introdotto un wizard separato per docenti o classi.

Quando `deliveryMode = synchronized`, le impostazioni specifiche della sincronizzazione e del quiz vengono mostrate tramite progressive disclosure all'interno del workflow esistente.

## SV-03 — Alias mnemonico distinto dal titolo editoriale

Il nome usato dagli studenti per entrare non coincide obbligatoriamente con `VisitRevision.title`.

La configurazione sincronizzata contiene un alias mnemonico user-facing, concettualmente:

```text
synchronization.joinAlias = "Fenice rossa"
```

L'alias deve essere facile da leggere, ricordare e digitare anche da bambini. Può essere generato automaticamente e modificato dalla docente.

Non vengono usati ID Mongo, UUID o codici tecnici come interfaccia primaria di ingresso.

## SV-04 — Predisposizione editoriale e attivazione runtime sono concetti diversi

Marcare una visita come sincronizzata non crea una sessione attiva e non pubblica i contenuti inclusi.

La docente avvia esplicitamente una sessione di gruppo dal Navigator. Solo in quel momento viene creato il runtime condiviso.

La formulazione canonica è:

> Una visita marcata come sincronizzata può essere avviata dalla guida come sessione di gruppo. La sessione rende temporaneamente fruibili ai partecipanti i contenuti inclusi nella revisione pinzata della visita, compresi quelli privati autorizzati; la guida controlla quale tappa è attiva, mentre ogni partecipante può personalizzare soltanto la presentazione del contenuto corrente nei limiti delle azioni disponibili.

## SV-05 — Aggregate runtime di gruppo separato dalle VisitSession personali

La sincronizzazione introduce un aggregate runtime superiore, concettualmente `SynchronizedVisitSession`.

Responsabilità minima:

```text
SynchronizedVisitSession
- visitId
- visitRevisionId
- hostUserId
- joinAlias
- status
- currentEntryIndex
- runtimeVersion
- participants / membership state
- quiz runtime state
- timestamps
```

Questo aggregate rappresenta lo stato condiviso del gruppo e non sostituisce `VisitSessionV2`.

Ogni docente/studente continua ad avere una propria `VisitSessionV2`, collegata opzionalmente alla sessione sincronizzata. In questo modo il piano/tappa condivisa e l'esperienza individuale restano separati.

## SV-06 — Si sincronizza il punto della visita, non necessariamente la Representation

La sessione di gruppo determina **dove** si trova il gruppo nella visita: il `ContentEntry`/stato di avanzamento attivo è deciso dalla docente.

La singola `VisitSessionV2` determina invece **come** quel contenuto viene presentato al partecipante.

Quindi due studenti possono essere sulla stessa tappa ma ricevere Representation differenti per profondità o complessità linguistica. Possono inoltre aprire approfondimenti semantici personali senza spostare il resto del gruppo.

Questa separazione è intenzionalmente predisposta anche alla fascia 18–33, dove la stessa visita sincronizzata può adattarsi a partecipanti con profili differenti.

## SV-07 — La docente controlla la progressione globale

Durante una sessione sincronizzata la docente/host è l'autorità sulla progressione del gruppo.

Gli studenti non possono avanzare o tornare indietro autonomamente nella sequenza della visita.

La restrizione viene applicata dal backend tramite il protocollo `AvailableAction[]`: una sessione participant non riceve azioni `PROGRESS_NEXT`/`PROGRESS_PREVIOUS`, mentre l'host riceve le azioni di controllo consentite.

Il client non deve limitarsi a nascondere pulsanti tramite CSS o branch locali sul ruolo.

## SV-08 — Gli adattamenti individuali restano disponibili

Gli studenti possono utilizzare le azioni di presentation e semantic exploration consentite, ad esempio:

- richiesta di maggiore/minore approfondimento;
- linguaggio più semplice/più complesso;
- approfondimenti semantici derivati dal graph e dai contenuti pinzati.

Tali azioni modificano soltanto la loro `VisitSessionV2`. Non cambiano `SynchronizedVisitSession.currentEntryIndex` e non alterano l'esperienza degli altri partecipanti.

## SV-09 — Lobby semplice e controllo dei partecipanti

L'avvio della visita sincronizzata crea inizialmente una lobby.

La docente vede almeno:

- alias della visita;
- numero di partecipanti entrati;
- elenco/stato dei partecipanti;
- azione esplicita per iniziare la visita.

Lo studente entra usando l'alias mnemonico e, prima dell'inizio, vede una schermata minimale di attesa.

La UX deve essere utilizzabile da bambini: niente configurazioni tecniche, ID, gestione manuale delle sessioni o concetti Marketplace esposti nell'ingresso.

## SV-10 — Il Navigator resta unico

Non viene creata una seconda applicazione Navigator per docenti o studenti.

Il Navigator esistente usa projection e `AvailableAction[]` differenti in funzione dell'authority runtime dell'utente:

- host: controlli di sessione, progressione, stato partecipanti, richieste e quiz;
- participant: contenuto corrente, adattamenti personali consentiti e stato di attesa/sincronizzazione.

Il backend resta autorevole sulle capability; Vue presenta le operazioni disponibili.

## SV-11 — Telemetria osservabile, non riconoscimento dell'attenzione

Il requisito di controllare se e come gli studenti stanno seguendo viene implementato con segnali applicativi osservabili e già coerenti con il runtime, non con webcam, eye tracking o inferenze biometriche.

La dashboard docente può mostrare dati come:

- contenuto non avviato;
- riproduzione/ascolto in corso;
- pausa;
- completamento;
- `completionRatio`/esperienza registrata;
- richieste di approfondimento o semplificazione effettuate dallo studente.

`InteractionEvent` e `ContentEntryExperience` sono le primitive da riusare/estendere invece di creare una seconda telemetria scolastica parallela.

## SV-12 — Accesso temporaneo ai contenuti privati tramite partecipazione alla sessione

Una visita sincronizzata può includere contenuti privati/non pubblici che la docente è autorizzata a usare.

Lo studente non deve acquisire individualmente tali contenuti né ricevere un Entitlement Marketplace permanente.

La partecipazione valida alla `SynchronizedVisitSession` costituisce una authority runtime temporanea limitata:

- alla VisitRevision pinzata dalla sessione;
- ai contenuti/snapshot necessari per eseguire quella sessione;
- alla durata e allo stato della sessione;
- alle operazioni consentite al participant.

Questa authority non pubblica il contenuto, non trasferisce ownership, non crea Acquisition e non permette riuso fuori dalla sessione.

## SV-13 — Snapshot stabile della VisitRevision durante l'esecuzione

Una `SynchronizedVisitSession` pinna una specifica `VisitRevision` all'avvio. Una successiva pubblicazione/modifica della Visit non cambia silenziosamente una classe già in corso.

Le singole `VisitSessionV2` dei partecipanti devono riferirsi alla stessa source editoriale/piano coerente con la sessione di gruppo.

Le regole già approvate su snapshot fisici, VenueRelease/LayoutRevision e preparation continuano ad applicarsi; la sincronizzazione non reintroduce lookup live non versionati durante il runtime.

## SV-14 — Realtime come notifica di invalidazione, REST/projection come fonte autorevole

Per la sincronizzazione interattiva viene introdotto un trasporto realtime, preferibilmente Socket.IO/WebSocket, integrato nello stesso backend Node/Express.

Una room corrisponde alla `SynchronizedVisitSession`.

Gli eventi realtime comunicano cambiamenti di stato, ad esempio avanzamento della tappa, inizio/fine visita, ingresso/uscita partecipante o avvio quiz. Non trasportano come fonte primaria l'intero contenuto editoriale.

Il pattern preferito è:

```text
command host
→ backend aggiorna stato/versione
→ evento realtime "group state changed"
→ client aggiorna/applica la projection autorevole
```

Le normali API/projection restano la fonte di verità. Il realtime è un sottile meccanismo di notifica e non una seconda business API.

## SV-15 — Versione runtime e concorrenza

Lo stato condiviso della sessione sincronizzata è versionato (`runtimeVersion` o equivalente).

I comandi che modificano lo stato globale devono essere validati rispetto allo stato/versione corrente per impedire doppio avanzamento, retry non idempotenti o aggiornamenti fuori ordine.

I client che ricevono un evento stale o perdono una notifica recuperano la projection corrente dal backend invece di ricostruire lo stato localmente.

## SV-16 — Quiz definito editorialmente, tentativi runtime separati

Le domande del quiz appartengono alla configurazione/versione della visita sincronizzata, quindi sono contenuto editoriale della `VisitRevision`.

Modello minimo concettuale:

```text
quiz
  questions[]
    question
    options[]
    correctOptionId
    points? 
```

Le risposte, i tentativi, lo stato di avanzamento e il risultato di ogni studente appartengono invece alla sessione runtime e non vengono scritti nella `VisitRevision`.

La docente avvia esplicitamente il quiz. Gli studenti ricevono una UI semplice, una domanda alla volta o equivalente, e al termine attendono la chiusura/valutazione della docente.

## SV-17 — Quiz e valutazione restano semplici per il 18–27

Il primo incremento non introduce un LMS, classi permanenti, registri scolastici o rubriche complesse.

Sono sufficienti:

- domande multiple choice configurate nella visita;
- risposta per partecipante;
- correzione deterministica in base a `correctOptionId`;
- score riepilogativo;
- possibilità per la docente di vedere i risultati e confermare/assegnare la valutazione richiesta dalla specifica.

Estensioni più sofisticate richiedono un requisito esplicito successivo.

## SV-18 — UX participant minimalista

Il flusso participant deve essere progettato per utenti anche molto giovani.

Principi confermati:

- ingresso tramite alias semplice;
- stato di attesa evidente;
- una sola tappa/contenuto corrente;
- nessun controllo di progressione globale;
- azioni personali espresse con linguaggio semplice;
- feedback immediato quando la docente cambia tappa;
- quiz con scelte grandi e comprensibili;
- dettagli tecnici e concetti di dominio non esposti.

## SV-19 — UX host orientata al controllo del gruppo

La vista docente deve privilegiare:

- tappa corrente e progressione della visita;
- partecipanti collegati/disconnessi;
- stato di fruizione osservabile;
- richieste/adattamenti effettuati dagli studenti;
- azione primaria per presentare/avanzare;
- passaggio esplicito al quiz e chiusura della sessione.

Non deve richiedere alla docente di amministrare direttamente VisitSession individuali o messaggi WebSocket.

## SV-20 — Incrementi di implementazione

L'implementazione viene sviluppata per vertical slice, preservando sempre la normale modalità 18–24.

Ordine approvato:

1. **Authoring/editorial slice**: `deliveryMode`, configurazione sincronizzata, alias, quiz, validation/projection/copy/revision workflow e UI Marketplace;
2. **Group runtime slice**: `SynchronizedVisitSession`, membership/lobby, join e collegamento alle `VisitSessionV2`;
3. **Synchronization slice**: controllo host, progressione comune, realtime, policy `AvailableAction[]` host/participant;
4. **Observation + quiz slice**: telemetria aggregata docente, richieste studenti, quiz attempts, risultati e chiusura.

Il realtime non viene introdotto prima di avere un modello runtime autorevole e testabile via API.

# Invarianti da preservare

- La Visit non diventa un array di testi.
- Gli Item restano contenuti; logistica e stato di sincronizzazione non diventano Item.
- `VisitRevision` resta editoriale/versionata; lo stato live non viene scritto dentro la revision.
- `VisitSessionV2` continua a rappresentare l'esperienza individuale.
- Lo stato condiviso viene modellato una sola volta nel group runtime.
- Authorization e azioni disponibili restano backend-authoritative.
- Presentation individuale e progressione condivisa restano separate.
- I contenuti privati non vengono resi pubblici o acquisiti permanentemente per effetto del join.
- Navigator e Marketplace mantengono le responsabilità già stabilite.
- La soluzione deve poter evolvere verso le capability 18–33 senza richiedere un secondo modello di sessione o presentation.

# Questioni ancora da progettare

Le seguenti parti non sono ancora decisioni definitive e devono essere progettate prima dell'implementazione dei relativi slice:

- modello esatto di membership/participant e relativo lifecycle;
- requisiti di autenticazione degli studenti e identità mostrata alla docente;
- generazione, unicità, collisioni e durata del `joinAlias`;
- join, rejoin, disconnect e recupero dopo perdita di rete;
- relazione esatta fra host `VisitSessionV2` e `SynchronizedVisitSession`;
- creazione delle participant `VisitSessionV2` e piano condiviso/personalizzato;
- command/API definitivi del group runtime;
- schema degli eventi realtime e strategia di reconnect;
- aggregazione efficiente della telemetria per la dashboard docente;
- persistenza esatta dei quiz attempts e della valutazione;
- policy di completamento/abbandono quando la sessione di gruppo termina.

Queste questioni verranno aggiunte alla sezione delle decisioni approvate solo dopo la relativa approvazione.