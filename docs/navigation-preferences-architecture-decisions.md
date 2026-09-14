# Navigation preferences — decisioni architetturali

Stato: **approvato e implementato nel refactoring Navigation Preferences v3**.

Questa decisione è successiva ai punti 13–15 di `docs/client-architecture-decisions.md`. Mantiene le invarianti di quei punti ma **sostituisce** la formulazione del punto 14 secondo cui i `routingProfiles` costituiscono l'interfaccia user-facing principale della preparazione del percorso.

## 1. Tre scope distinti

ArtAround distingue tre concetti che non devono essere fusi.

### Esigenze personali globali

Le esigenze personali sono preferenze funzionali del visitatore che hanno senso in musei diversi. Sono persistite in `User.defaultNavigationPreference.requirements` e sono rappresentate esclusivamente tramite `PhysicalFeatureRef.semantic` con riferimenti `artaround-physical:*` `exact`.

Il catalogo canonico iniziale comprende:

- `step_free`;
- `obstacles_present`;
- `tactile_guidance`;
- `narrow_passage`;
- `minimum_width_cm`;
- `slope_percent`.

Le esigenze sono atomiche e combinabili. Non rappresentano categorie mediche o identità della persona. Il visitatore sceglie tra `preferred` e `required`; il peso non è configurabile dall'utente.

### Opzioni locali della Venue

Una `PhysicalAttributeDefinition` può dichiarare un `visitorControl`. Il controllo è definito dalla revisione del Physical Vocabulary pinzata dalla Venue e può essere mostrato nel Navigator soltanto per quella Venue.

Il client invia una selezione user-facing `{ venueId, physicalAttributeDefinitionId, value? }`. Il backend la valida contro la revisione fisica pinzata e la compila in un requisito con `PhysicalFeatureRef.local`. Il requisito compilato viene conservato nello snapshot sotto `venueRequirements`.

Un'opzione locale non viene mai salvata automaticamente nel profilo dell'utente e non viene applicata ad altre Venue.

### Routing profile locali

I `routingProfiles` restano preset locali appartenenti a una specifica Physical Vocabulary Revision. Possono combinare più requirement e sono utili quando una sede vuole proporre un comportamento di routing ricorrente.

Sono però un'interfaccia **secondaria** rispetto alle esigenze personali atomiche. Non costituiscono identità globali e non vengono unificati tra Venue per `key`, label o traduzione.

## 2. Priorità user-facing

La UI personale espone solo:

- **Preferisco** → `preferred`;
- **Necessario** → `required`.

`avoid` resta una semantica interna disponibile al dominio del routing e ai preset/local controls quando appropriato, ma non è una terza intensità generica dei default personali.

## 3. Contratto semantico canonico

Un riferimento `artaround-physical:*` `exact` è valido soltanto se la definizione locale è compatibile con il concetto canonico per:

- `dataType`;
- `unit`;
- `appliesTo`.

Il resolver automatico non usa mapping `close`, `broader` o `narrower` come equivalenza di routing.

Per i concetti con `appliesTo: both`, una definizione limitata soltanto a `place` o soltanto a `connection` non è considerata equivalente exact.

## 4. Preparation e snapshot

`PreparationDraft` conserva le scelte temporanee user-facing. Il backend ricalcola il percorso e compila le opzioni locali prima dello start.

`NavigationSnapshot` contiene:

- `movementPacePreference`;
- `requirements`: esigenze/global requirements;
- `routingProfileSelections`: al massimo un profilo per Venue;
- `venueRequirements`: requirement locali compilati e raggruppati per Venue.

La Session non dipende dai controlli UI originali: allo start riceve soltanto lo snapshot compilato.

Lo start di una visita non modifica automaticamente `User.defaultNavigationPreference`. Un eventuale caso d'uso “salva come mie preferenze” deve essere un'azione separata ed esplicita.

## 5. Composizione nel routing

Per ogni Venue il routing effettivo combina nello stesso resolver:

1. requirement globali/personali;
2. requirement locali di quella Venue;
3. requirement del routing profile locale selezionato.

I requirement `required` sono hard constraint. Una combinazione hard incompatibile genera `ROUTING_REQUIREMENT_CONFLICT`; non esiste una precedenza silenziosa con cui un profilo locale possa indebolire un requisito globale.

Le preferenze soft non supportate producono warning secondo la policy già esistente. Un requirement globale `required` che non può essere verificato durante un trasferimento inter-Venue continua a bloccare la preparazione finché non esiste un provider in grado di verificarlo.

## 6. UX

### Marketplace / Profilo

La sezione personale espone **Movimento e percorso**: ritmo ed esigenze canoniche globali. Le esigenze possono essere combinate e, per quelle numeriche, configurate con la soglia prevista dal catalogo canonico.

### Marketplace / Physical Vocabulary

L'editor delle caratteristiche fisiche può configurare un `visitorControl` all'interno della stessa `PhysicalAttributeDefinition`. Non esiste un editor parallelo delle opzioni di visita.

### Navigator / Pre-visita

La preparazione mostra prima **Le tue esigenze**, inizializzate dai default personali, quindi le **Opzioni della sede**. Per ogni Venue possono comparire routing profile e visitor controls locali. Il percorso senza profilo è presentato come **Percorso standard**, cioè il percorso più rapido compatibile con i vincoli effettivi.

Le modifiche effettuate qui sono preparation-only.

## 7. Visite sincronizzate

Nell'esecuzione sincronizzata lo snapshot fisico condiviso è deciso dall'host e viene congelato nella `SynchronizedVisitSession`. Le preferenze personali dei partecipanti non modificano implicitamente il percorso comune.

Il modello resta predisposto a una futura aggregazione esplicita dei requirement dei partecipanti: gli hard constraint atomici possono essere combinati e validati prima dello start senza trasformare profili monolitici in identità personali.

## 8. Starter fisico

Lo starter v2 resta generico rispetto al museo e contiene solo proprietà fisiche verificabili. Sono rimossi dal baseline i concetti esperienziali `sensory_load` / `quiet_area`, il profilo `quiet` e il profilo `shortest` che dichiarava un'ottimizzazione non implementata dal routing.

Lo starter non abilita automaticamente `visitorControl`: spetta all'autore della Physical Vocabulary decidere quali caratteristiche locali esporre al visitatore.
