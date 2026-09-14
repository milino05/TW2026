# Navigation preferences — decisioni architetturali

Stato: **approvato e implementato nel refactoring Navigation Preferences v3**.

Questa decisione è successiva ai punti 13–15 di `docs/client-architecture-decisions.md`. Mantiene le invarianti di quei punti ma **sostituisce** la formulazione del punto 14 secondo cui i `routingProfiles` costituiscono l'interfaccia user-facing principale della preparazione del percorso.

## 1. Tre scope distinti

ArtAround distingue tre concetti che non devono essere fusi.

### Preferenze globali persistenti

`User.defaultNavigationPreference.requirements` resta un contratto **semantic e provider-neutral**. Una preferenza persistente non usa UUID/key locali di una Venue e `UserPreferenceService` valida forma, operatori e valori senza dipendere da un catalogo chiuso della piattaforma.

ArtAround offre inizialmente un catalogo UX di sei esigenze funzionali cross-museo, mappate internamente a semantic ref `artaround-physical:*` `exact`:

- `step_free`;
- `obstacles_present`;
- `tactile_guidance`;
- `narrow_passage`;
- `minimum_width_cm`;
- `slope_percent`.

Questo catalogo è una **projection/compilation boundary della UX**, non l'intero modello persistente. Altri `PhysicalFeatureRef.semantic` validi possono coesistere nel profilo e devono essere preservati quando l'utente modifica le sei esigenze esposte dalla UI.

Le esigenze del catalogo sono atomiche e combinabili. Non rappresentano categorie mediche o identità della persona. Per queste sei esigenze il visitatore sceglie tra `preferred` e `required`; il peso è fissato backend-side a `1` e non è configurabile dalla UI.

### Opzioni locali della Venue

Una `PhysicalAttributeDefinition` può dichiarare un `visitorControl`. Il controllo è definito dalla revisione del Physical Vocabulary pinzata dalla Venue e può essere mostrato nel Navigator soltanto per quella Venue.

Il client invia una selezione user-facing `{ venueId, physicalAttributeDefinitionId, value? }`. Il backend la valida contro la revisione fisica pinzata e la compila in un requisito con `PhysicalFeatureRef.local`. Il requisito compilato viene conservato nello snapshot sotto `venueRequirements`.

Un'opzione locale non viene mai salvata automaticamente nel profilo dell'utente e non viene applicata ad altre Venue.

### Routing profile locali

I `routingProfiles` restano preset locali appartenenti a una specifica Physical Vocabulary Revision. Possono combinare più requirement e sono utili quando una sede vuole proporre un comportamento di routing ricorrente.

Sono però un'interfaccia **secondaria** rispetto alle esigenze personali atomiche. Non costituiscono identità globali e non vengono unificati tra Venue per `key`, label o traduzione.

## 2. Contratto client/backend delle esigenze canoniche

Marketplace e Navigator non costruiscono `PhysicalFeatureRef`, operatori, pesi o requirement tecnici per le sei esigenze canoniche. Inviano esclusivamente selezioni user-facing:

```text
{ id, priority, value? }
```

Il backend valida la selezione contro il catalogo UX e la compila nel relativo routing requirement canonico. Quando la UI aggiorna le esigenze del catalogo, viene sostituito **solo il sottoinsieme `artaround-physical` riconosciuto dal catalogo**; eventuali altri requirement semantic/provider-neutral già presenti vengono preservati.

Il payload tecnico generico `requirements[]` resta valido nei boundary backend/advanced che ne hanno realmente bisogno, ma non è il contratto della UI di preparation del Navigator.

## 3. Priorità user-facing

La UI del catalogo personale espone solo:

- **Preferisco** → `preferred`;
- **Necessario** → `required`.

`avoid` resta una semantica disponibile al dominio del routing e ai preset/local controls quando appropriato, ma non è una terza intensità generica delle sei esigenze del catalogo personale.

## 4. Contratto semantico canonico

Un riferimento `artaround-physical:*` `exact` è valido soltanto se la definizione locale è compatibile con il concetto canonico per:

- `dataType`;
- `unit`;
- `appliesTo`.

Il resolver automatico non usa mapping `close`, `broader` o `narrower` come equivalenza di routing.

La compatibilità dello scope è intenzionalmente direzionale: quando il concetto canonico richiede `connection` o `place`, una definizione locale `both` è valida perché copre lo scope richiesto; quando il concetto canonico richiede `both`, una definizione locale limitata a un solo scope non è equivalente.

## 5. Preparation e snapshot

`PreparationDraft` conserva le scelte temporanee user-facing. Per le esigenze canoniche usa `personalNeedSelections`; per le opzioni locali usa `venueControlSelections`; i profili restano `routingProfileSelections`.

A ogni ricalcolo il backend compila le selezioni e costruisce il `NavigationSnapshot`, che contiene:

- `movementPacePreference`;
- `requirements`: requirement globali semantic, inclusi quelli provider-neutral non rappresentati dal catalogo UX;
- `routingProfileSelections`: al massimo un profilo per Venue;
- `venueRequirements`: requirement locali compilati e raggruppati per Venue.

La Session non dipende dai controlli UI originali: allo start riceve soltanto lo snapshot compilato.

Lo start di una visita non modifica automaticamente `User.defaultNavigationPreference`. Un eventuale caso d'uso “salva come mie preferenze” deve essere un'azione separata ed esplicita.

## 6. Composizione nel routing

Per ogni Venue il routing effettivo combina nello stesso resolver:

1. requirement globali/personali;
2. requirement locali di quella Venue;
3. requirement del routing profile locale selezionato.

I requirement `required` sono hard constraint. Una combinazione hard incompatibile genera `ROUTING_REQUIREMENT_CONFLICT`; non esiste una precedenza silenziosa con cui un profilo locale possa indebolire un requisito globale.

Le preferenze soft non supportate producono warning secondo la policy già esistente. Un requirement globale `required` che non può essere verificato durante un trasferimento inter-Venue continua a bloccare la preparazione finché non esiste un provider in grado di verificarlo.

## 7. UX

### Marketplace / Profilo

La sezione personale espone **Movimento e percorso**: ritmo e le sei esigenze del catalogo UX. Il salvataggio aggiorna soltanto questo sottoinsieme e non elimina eventuali altri requirement semantic persistenti.

### Marketplace / Physical Vocabulary

L'editor delle caratteristiche fisiche può configurare un `visitorControl` all'interno della stessa `PhysicalAttributeDefinition`. Non esiste un editor parallelo delle opzioni di visita.

### Navigator / Pre-visita

La preparazione mostra prima **Le tue esigenze**, inizializzate dai default personali, quindi le **Opzioni della sede**. Per ogni Venue possono comparire routing profile e visitor controls locali. Il percorso senza profilo è presentato come **Percorso standard**, cioè il percorso più rapido compatibile con i vincoli effettivi.

Il Navigator invia selezioni user-facing e non interpreta requirement tecnici, UUID del Physical Vocabulary, operatori o pesi. Le modifiche effettuate qui sono preparation-only.

## 8. Visite sincronizzate

Nell'esecuzione sincronizzata lo snapshot fisico condiviso è deciso dall'host e viene congelato nella `SynchronizedVisitSession`. Le preferenze personali dei partecipanti non modificano implicitamente il percorso comune.

Il modello resta predisposto a una futura aggregazione esplicita dei requirement dei partecipanti: gli hard constraint atomici possono essere combinati e validati prima dello start senza trasformare profili monolitici in identità personali.

## 9. Starter fisico

Lo starter v2 resta generico rispetto al museo e contiene solo proprietà fisiche verificabili. Sono rimossi dal baseline i concetti esperienziali `sensory_load` / `quiet_area`, il profilo `quiet` e il profilo `shortest` che dichiarava un'ottimizzazione non implementata dal routing.

Lo starter contiene una definizione fisica semanticamente allineata per ciascuna delle sei esigenze del catalogo canonico ed è predisposto perché tali caratteristiche siano assegnabili ai collegamenti. Non abilita automaticamente `visitorControl`: spetta all'autore della Physical Vocabulary decidere quali caratteristiche locali esporre come opzioni specifiche della visita.
