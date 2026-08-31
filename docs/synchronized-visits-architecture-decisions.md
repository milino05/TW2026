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
- `SessionPlanRevisionV2` è attualmente owned da una singola `VisitSessionV2` tramite `sessionId` e dovrà essere generalizzato per supportare il piano condiviso del gruppo;
- il backend corrente è Node/Express/Mongoose e non dispone ancora di un trasporto realtime WebSocket/Socket.IO.

Queste caratteristiche vengono riusate: la sincronizzazione non introduce un secondo modello di Visit, un secondo Navigator o una pipeline di presentation parallela.

# Decisioni approvate

## SV-01 — Una Visit, modalità di fruizione esplicita

La visita continua a essere un unico dominio editoriale. Una `VisitRevision` dichiara la propria modalità di fruizione tramite un valore tipizzato, concettualmente `deliveryMode = self_guided | synchronized`. La UI può presentare questa scelta come un semplice toggle **Visita sincronizzata**, ma il dominio non usa flag runtime sparsi. La modalità sincronizzata è una proprietà della revisione editoriale; l'esecuzione di gruppo appartiene a un runtime separato.

## SV-02 — Il workflow di authoring esistente viene preservato

Il workflow canonico resta **Informazioni principali → Costruisci la visita → Impostazioni → Percorso → Pubblicazione**. L'opzione **Visita sincronizzata** viene proposta nel primo step. Quando è attiva, impostazioni di sincronizzazione e quiz compaiono tramite progressive disclosure nel workflow esistente. Non viene introdotto un wizard separato per docenti o classi.

## SV-03 — Alias mnemonico distinto dal titolo editoriale

Il nome usato dagli studenti per entrare non coincide obbligatoriamente con `VisitRevision.title`. La configurazione sincronizzata contiene un alias mnemonico user-facing, concettualmente `synchronization.joinAlias = "Fenice rossa"`, facile da leggere, ricordare e digitare anche da bambini. Può essere generato automaticamente e modificato dalla docente. Mongo ID, UUID o codici tecnici non sono l'interfaccia primaria di ingresso.

## SV-04 — Predisposizione editoriale e attivazione runtime sono concetti diversi

Marcare una visita come sincronizzata non crea una sessione attiva e non pubblica i contenuti inclusi. La docente avvia esplicitamente una sessione di gruppo dal Navigator. La sessione rende temporaneamente fruibili ai partecipanti i contenuti della revisione pinzata, compresi quelli privati autorizzati; la guida controlla la tappa attiva, mentre ogni partecipante può personalizzare soltanto la propria presentazione nei limiti delle azioni disponibili.

## SV-05 — Aggregate runtime di gruppo separato dalle VisitSession personali

La sincronizzazione introduce un aggregate runtime superiore, concettualmente `SynchronizedVisitSession`, con almeno `visitId`, `visitRevisionId`, `hostUserId`, `joinAlias`, `status`, `currentEntryIndex`, `runtimeVersion`, riferimenti al piano condiviso, stato quiz e timestamps. Questo aggregate rappresenta lo stato condiviso e non sostituisce `VisitSessionV2`. Ogni partecipante continua ad avere una propria `VisitSessionV2` collegata alla sessione sincronizzata.

## SV-06 — Si sincronizza il punto della visita, non necessariamente la Representation

La sessione di gruppo determina **dove** si trova il gruppo nella visita: il `ContentEntry` attivo è deciso dalla docente. La singola `VisitSessionV2` determina invece **come** quel contenuto viene presentato al partecipante. Studenti sulla stessa tappa possono quindi ricevere Representation differenti per profondità o complessità linguistica e usare approfondimenti personali senza spostare il gruppo. Questa separazione prepara direttamente la fascia 18–33.

## SV-07 — La docente controlla la progressione globale

Durante una sessione sincronizzata la docente/host è l'autorità sulla progressione del gruppo. Gli studenti non possono avanzare o tornare indietro autonomamente. La restrizione è backend-authoritative: una sessione participant non riceve `PROGRESS_NEXT`/`PROGRESS_PREVIOUS`, mentre l'host riceve le azioni consentite. Il client non implementa la policy limitandosi a nascondere pulsanti.

## SV-08 — Gli adattamenti individuali restano disponibili

Gli studenti possono utilizzare le azioni di presentation e semantic exploration consentite, come maggiore/minore approfondimento, linguaggio più semplice/più complesso e approfondimenti semantici. Tali azioni modificano soltanto la loro `VisitSessionV2`; non cambiano `SynchronizedVisitSession.currentEntryIndex` e non alterano l'esperienza degli altri partecipanti.

## SV-09 — Lobby semplice e controllo dei partecipanti

L'avvio della visita sincronizzata crea una lobby. La docente vede almeno alias, numero di partecipanti entrati, elenco/stato dei partecipanti e azione esplicita per iniziare. Lo studente entra usando l'alias e, prima dell'inizio, vede una schermata minimale di attesa. La UX non espone configurazioni tecniche, ID, session management o concetti Marketplace.

## SV-10 — Il Navigator resta unico

Non viene creata una seconda applicazione Navigator per docenti o studenti. Il Navigator esistente usa projection e `AvailableAction[]` differenti in funzione dell'authority runtime: l'host vede controlli di sessione, progressione, partecipanti, richieste e quiz; il participant vede contenuto corrente, adattamenti personali consentiti e stato di attesa/sincronizzazione. Il backend resta autorevole sulle capability.

## SV-11 — Telemetria osservabile, non riconoscimento dell'attenzione

Il requisito di controllare se e come gli studenti stanno seguendo viene implementato con segnali applicativi osservabili, non con webcam, eye tracking o inferenze biometriche. La dashboard può mostrare contenuto non avviato, riproduzione/ascolto, pausa, completamento, `completionRatio` ed azioni/richieste effettuate. `InteractionEvent` e `ContentEntryExperience` sono le primitive da riusare/estendere.

## SV-12 — Accesso temporaneo ai contenuti privati tramite partecipazione alla sessione

Una visita sincronizzata può includere contenuti privati/non pubblici che la docente è autorizzata a usare. Lo studente non deve acquisirli individualmente né ricevere un Entitlement Marketplace permanente. La partecipazione valida costituisce authority runtime temporanea limitata alla VisitRevision pinzata, ai contenuti/snapshot necessari, alla durata/stato della sessione e alle operazioni participant. Non pubblica il contenuto, non trasferisce ownership, non crea Acquisition e non permette riuso fuori sessione.

## SV-13 — Snapshot stabile della VisitRevision durante l'esecuzione

Una `SynchronizedVisitSession` pinna una specifica `VisitRevision` all'avvio. Modifiche o nuove publication della Visit non cambiano una classe già in corso. Le `VisitSessionV2` dei partecipanti devono riferirsi alla stessa source editoriale e allo stesso piano strutturale coerente con il gruppo. Le regole già approvate su snapshot fisici e preparation continuano ad applicarsi.

## SV-14 — Realtime come notifica di invalidazione, projection come fonte autorevole

Per la sincronizzazione interattiva viene introdotto un trasporto realtime, preferibilmente Socket.IO/WebSocket, integrato nello stesso backend Node/Express. Una room corrisponde alla `SynchronizedVisitSession`. Gli eventi realtime notificano cambiamenti di stato; non diventano la fonte primaria dei contenuti o della business logic. Il pattern è `command → aggiornamento backend/versione → notifica realtime → refresh/applicazione projection autorevole`.

## SV-15 — Versione runtime e concorrenza

Lo stato condiviso è versionato tramite `runtimeVersion` o equivalente. I comandi che modificano lo stato globale vengono validati rispetto alla versione corrente per impedire doppio avanzamento, retry non idempotenti o aggiornamenti fuori ordine. Un client che perde eventi recupera la projection corrente dal backend invece di ricostruire lo stato localmente.

## SV-16 — Quiz definito editorialmente, tentativi runtime separati

Le domande del quiz appartengono alla configurazione/versione della visita sincronizzata e quindi alla `VisitRevision`. Il modello minimo contiene domande multiple choice, opzioni, risposta corretta ed eventuali punti. Risposte, tentativi, stato e risultato di ogni studente appartengono invece al runtime e non vengono scritti nella `VisitRevision`. La docente avvia esplicitamente il quiz.

## SV-17 — Quiz e valutazione restano semplici per il 18–27

Il primo incremento non introduce LMS, classi permanenti, registri scolastici o rubriche complesse. Sono sufficienti domande multiple choice, risposta per partecipante, correzione deterministica, score riepilogativo e possibilità per la docente di vedere i risultati e confermare/assegnare la valutazione richiesta dalla specifica.

## SV-18 — UX participant minimalista

Il flusso participant è progettato anche per utenti molto giovani: ingresso tramite alias semplice, stato di attesa evidente, una sola tappa corrente, nessun controllo di progressione globale, azioni personali con linguaggio semplice, feedback immediato al cambio tappa, quiz con scelte grandi e comprensibili, nessun dettaglio tecnico esposto.

## SV-19 — UX host orientata al controllo del gruppo

La vista docente privilegia tappa corrente, progressione, partecipanti collegati/disconnessi, stato di fruizione osservabile, richieste/adattamenti, azione primaria per presentare/avanzare, passaggio al quiz e chiusura della sessione. Non richiede di amministrare direttamente VisitSession individuali o messaggi WebSocket.

## SV-20 — Incrementi di implementazione

L'implementazione procede per vertical slice, preservando la normale modalità 18–24:

1. **Authoring/editorial slice**: `deliveryMode`, configurazione sincronizzata, alias, quiz, validation/projection/copy/revision workflow e UI Marketplace;
2. **Group runtime slice**: `SynchronizedVisitSession`, membership/lobby, join e collegamento alle `VisitSessionV2`;
3. **Synchronization slice**: controllo host, progressione comune, realtime e policy `AvailableAction[]` host/participant;
4. **Observation + quiz slice**: telemetria aggregata docente, richieste studenti, quiz attempts, risultati e chiusura.

Il realtime non viene introdotto prima di avere un modello runtime autorevole e testabile via API.

## SV-21 — I partecipanti sono normali User autenticati

Per la prima implementazione 18–27 gli studenti entrano nella visita come normali `User` ArtAround autenticati. Non vengono introdotti guest account, utenti fittizi o identità temporanee. L'autenticazione avviene prima del join; nel flusso di partecipazione il bambino deve soltanto inserire l'alias della visita. L'identità stabile del `User` consente alla docente di riconoscere chi si è collegato e mantiene coerenti runtime, learning history e authorization.

## SV-22 — Membership separata dal group aggregate

La relazione fra utente e sessione sincronizzata è modellata tramite un'entità/documento separato, concettualmente `SynchronizedVisitMembership`, invece di un grande array `participants[]` continuamente mutato dentro `SynchronizedVisitSession`.

Il modello minimo contiene:

```text
SynchronizedVisitMembership
- synchronizedSessionId
- userId
- role: host | participant
- visitSessionId
- status: active | removed | completed
- joinedAt
- completedAt
```

La coppia `(synchronizedSessionId, userId)` è unica. `SV-22` specializza `SV-05`: l'aggregate di gruppo non incorpora le membership come source of truth.

## SV-23 — Membership e presenza realtime sono concetti distinti

Essere membro della visita e avere in quel momento una connessione realtime aperta sono stati differenti. Una perdita temporanea di rete non rimuove lo studente dalla visita. La membership resta persistente/attiva secondo il lifecycle applicativo; la presenza `online/offline` viene derivata dal layer realtime e può cambiare senza modificare la membership.

## SV-24 — Lifecycle del group runtime minimale

Il lifecycle iniziale di `SynchronizedVisitSession` è:

```text
lobby -> active -> quiz -> completed
```

con `cancelled` come stato terminale alternativo. Non vengono introdotti preventivamente stati come `scheduled`, `grading`, `archived` o altri workflow non richiesti. Una disconnessione di uno o più partecipanti non cambia automaticamente lo stato della sessione.

## SV-25 — Join e rejoin idempotenti

Il join tramite alias è idempotente rispetto alla coppia sessione/utente. Se uno studente già membro perde la rete, chiude il browser o ripete il join, il backend non crea una seconda membership: recupera quella esistente e restituisce la projection corrente. Se nel frattempo il gruppo è avanzato, lo studente rientra direttamente nello stato/tappa corrente del gruppo. Non sono previsti codici di recupero manuali per il normale reconnect.

## SV-26 — Alias runtime normalizzato e univoco solo fra sessioni joinable

`VisitRevision.synchronization.joinAlias` rappresenta l'alias preferito/editoriale. All'attivazione, `SynchronizedVisitSession.joinAlias` memorizza l'alias effettivamente assegnato al runtime.

La risoluzione dell'alias è normalizzata rispetto almeno a maiuscole/minuscole e whitespace, così forme equivalenti come `Fenice rossa`, `FENICE ROSSA` e spazi ridondanti individuano la stessa sessione. L'unicità non è globale e permanente: deve valere soltanto fra sessioni contemporaneamente joinable. In caso di collisione il backend assegna una variante ancora leggibile, ad esempio `Fenice rossa 2`, invece di sostituire l'esperienza principale con codici tecnici casuali.

## SV-27 — Un solo piano strutturale condiviso dal gruppo

Una visita sincronizzata non duplica lo stesso `SessionPlanRevisionV2` per ogni partecipante. Esiste un unico piano strutturale condiviso dal gruppo, che fissa la stessa VisitRevision, sequenza di ContentEntry, VisitAnchor, snapshot editoriali/fisici e percorso comune.

L'attuale ownership `SessionPlanRevisionV2.sessionId -> VisitSessionV2` viene quindi generalizzata concettualmente in un owner tipizzato, ad esempio:

```text
planOwnerType = visit_session | synchronized_visit_session
planOwnerId
```

Le visite normali continuano ad avere un piano owned dalla singola `VisitSessionV2`; le visite sincronizzate hanno un piano owned dalla `SynchronizedVisitSession` e riusato dalle sessioni personali dei membri. Questo refactoring evita N copie potenzialmente divergenti dello stesso piano.

## SV-28 — `currentEntryIndex` condiviso ha una sola source of truth

Nelle visite sincronizzate `SynchronizedVisitSession.currentEntryIndex` è l'unica fonte autorevole della progressione globale. Le `VisitSessionV2` collegate non mantengono una copia indipendentemente mutabile dello stesso indice.

Concettualmente:

```text
VisitSession standalone     -> session.currentEntryIndex
VisitSession synchronized   -> synchronizedSession.currentEntryIndex
```

Le projection delle sessioni participant derivano la tappa corrente dallo stato del gruppo. Un avanzamento host modifica un solo aggregate e incrementa la versione del group runtime; non richiede N update coordinati sulle sessioni personali.

## SV-29 — Piano comune, personalizzazione personale

Il piano condiviso contiene la baseline comune derivata dagli Item e da `VisitRevision.presentationBaseline`. Le preferenze personali e gli adattamenti runtime appartengono alla singola `VisitSessionV2`.

Le preferenze della docente non diventano baseline della classe. Ogni partecipante può applicare le proprie preferenze/default e i propri `presentationOverrides` o `semanticPresentation` sopra lo stesso contenuto/tappa comune. La separazione è quindi:

```text
shared structural plan + shared progress
                |
                +--> participant VisitSession: presentation/adaptation state
```

## SV-30 — I comandi host riusano l'Action Protocol

I controlli della docente non introducono una business API parallela basata su endpoint ad hoc per ogni pulsante. Le operazioni runtime del gruppo vengono esposte tramite lo stesso Action Protocol backend-authoritative già approvato, con `AvailableAction` differenti per host e participant.

L'host può ricevere azioni quali avvio visita, progressione, avvio quiz e completamento; il participant riceve soltanto le azioni personali consentite. Le action vengono rivalidate server-side rispetto a membership/role, stato del gruppo e `runtimeVersion` corrente.

# Invarianti da preservare

- La Visit non diventa un array di testi.
- Gli Item restano contenuti; logistica e stato di sincronizzazione non diventano Item.
- `VisitRevision` resta editoriale/versionata; lo stato live non viene scritto dentro la revision.
- `VisitSessionV2` continua a rappresentare l'esperienza individuale.
- Lo stato condiviso viene modellato una sola volta nel group runtime.
- Membership persistente e presence realtime restano separate.
- Il piano strutturale della visita sincronizzata è condiviso, non duplicato per partecipante.
- `currentEntryIndex` del gruppo ha una sola source of truth.
- Authorization e azioni disponibili restano backend-authoritative.
- Presentation individuale e progressione condivisa restano separate.
- I contenuti privati non vengono resi pubblici o acquisiti permanentemente per effetto del join.
- Navigator e Marketplace mantengono le responsabilità già stabilite.
- La soluzione deve poter evolvere verso le capability 18–33 senza richiedere un secondo modello di sessione o presentation.

# Questioni ancora da progettare

Le seguenti parti non sono ancora decisioni definitive e devono essere progettate prima dell'implementazione dei relativi slice:

- relazione esatta fra host `VisitSessionV2` e `SynchronizedVisitSession` e necessità effettiva di una sessione personale per l'host;
- schema Mongo/API esatto della generalizzazione `SessionPlanRevisionV2` e compatibilità con i service attuali;
- command/API wire definitivi del group runtime e projection host/participant;
- schema preciso degli eventi realtime e strategia tecnica di reconnect/presence;
- aggregazione efficiente della telemetria per la dashboard docente;
- persistenza esatta dei quiz attempts e della valutazione;
- policy di completamento/abbandono delle `VisitSessionV2` participant quando la sessione di gruppo termina;
- dettagli di authorization del join e del temporary execution access ai contenuti privati nei service esistenti.

Queste questioni verranno aggiunte alla sezione delle decisioni approvate solo dopo la relativa approvazione.