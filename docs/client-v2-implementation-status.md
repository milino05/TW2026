# ArtAround — Stato implementazione client e Physical Domain

Questo documento descrive lo stato corrente del branch `codex/physical-domain-redesign`. Non è una specifica normativa: requisiti ufficiali e decisioni architetturali approvate hanno priorità. Le implementazioni storiche non più coerenti con il dominio corrente non sono documentate come contratti supportati.

## Stato corrente

Il redesign del Physical Domain è implementato trasversalmente su dominio, backend, Marketplace e boundary Navigator. La fase di test/CI del redesign viene trattata separatamente e non è dichiarata completata in questo documento.

## PhysicalVocabulary

`PhysicalVocabulary` è una risorsa autonoma e versionata, possedibile da User o Organization. Ogni vocabulary dispone di working/published revision, lifecycle, workflow di review/publication e fork.

Una `PhysicalVocabularyRevision` contiene esclusivamente:

- `placeTypes[]`;
- `connectionTypes[]`;
- `physicalAttributes[]`;
- `routingProfiles[]`.

Le definition usano `definitionId` locale e possono avere label, descrizioni, alias, localizzazioni, `semanticRefs` e metadata. Alias e semantic reference hanno responsabilità differenti: i primi supportano il linguaggio umano locale, le seconde l'interoperabilità tra vocabulary.

Non esiste un catalogo fisico globale ArtAround e non sono contratti supportati `GLOBAL_PLACE_INTENTS`, `GLOBAL_ROUTING_ATTRIBUTE_CATALOG`, `canonicalKey`, `FIND_TOILET`, `FIND_EXIT`, `FIND_ELEVATOR` o equivalenti globali.

Lo starter ArtAround è un dataset ricco e riapplicabile in modo non distruttivo; non costituisce un'ontologia globale obbligatoria.

## Layout e Venue

`LayoutRevision` pinna esattamente la `PhysicalVocabularyRevision` contro cui è stato creato tramite `authoredAgainstPhysicalVocabularyRevisionId`.

Il Layout contiene:

- floors e managed map asset;
- Places tipizzati tramite `placeTypeDefinitionId` locale;
- Connections tipizzate tramite `connectionTypeDefinitionId` locale;
- physical attribute values tipizzati;
- geometry e metric mode;
- VenueTarget placements.

Il Layout non contiene più proprie definizioni di place type, routing attribute o routing preset.

Il Marketplace modifica la configurazione fisica mediante command applicativi server-authoritative. Il frontend non riscrive un mega-snapshot tecnico e non usa converter permanenti per mantenere il precedente schema embedded.

### Venue editor

La IA corrente è:

1. Panoramica;
2. Oggetti;
3. Spazi e mappa;
4. Informazioni visitatori;
5. Pubblicazione.

`Spazi e mappa` gestisce floor, plan upload, calibrazione, Place, Connection, geometria, metriche, attributi fisici, collegamenti cross-floor e placement dei VenueTarget. Il normale authoring non richiede ObjectId, coordinate normalizzate, URL asset manuali, JSON grezzi o key canoniche globali.

`VenueTarget` resta distinto da Place e da Item editoriale. Possiede un `publicCode` stabile e pubblico, separato dal Mongo ObjectId, predisposto per futuri marker/QR.

## PhysicalVocabulary Marketplace UX

Il Marketplace dispone di un editor autonomo per PhysicalVocabulary, accessibile dalle risorse personali, dalle Organization e contestualmente dalla Venue che lo utilizza.

L'editor espone progressivamente:

- generale;
- tipi di luogo;
- tipi di collegamento;
- caratteristiche fisiche;
- profili di percorso;
- mapping esterni.

Il primo flusso di creazione Venue prevede onboarding del PhysicalVocabulary quando il principal non ne possiede uno utilizzabile, con starter ArtAround consigliato, creazione da zero o scelta di una risorsa esistente quando applicabile.

## Routing e riferimenti fisici federati

Il routing engine consuma soltanto definition locali risolte contro il PhysicalVocabulary pinzato dal Layout.

Le preferenze e i requirement usano `PhysicalFeatureRef`:

- local reference per definition appartenenti a uno specifico vocabulary;
- semantic reference per richieste interoperabili tra vocabulary/Venue.

La traduzione semantica avviene tramite mapping espliciti; label, alias o key simili non producono equivalenza implicita. I requirement `required` non risolvibili producono blocker; `preferred` e `avoid` producono warning/non-applicabilità secondo il relativo contratto.

`routingAttributeCatalog.service.js` è stato rimosso. Il runtime non dipende da attributi fisici globali.

## Visit authoring

Il modello persistente mantiene separati `ContentEntry` e `VisitAnchor`; non esiste un `VisitStop` persistente parallelo.

Il Marketplace usa una projection stop-centric composta da:

- `stops[]` derivati dagli anchor con i relativi contenuti;
- `contextualEntries[]` per contenuti senza delivery anchor;
- `routeReview` derivata dalla configurazione fisica pubblicata.

Le operazioni strutturali passano da command semantici: aggiunta/rimozione contenuto, aggiunta/rimozione tappa, assegnazione/detach contenuto, ruolo e riordino stop. Il frontend non riscrive direttamente `contentEntries[]` o `visitAnchors[]` per queste operazioni.

L'inferenza Content → VisitAnchor usa il `primarySubjectId` editoriale e le occurrence fisiche pubblicate:

- una occurrence utilizzabile: anchor creato o riusato automaticamente;
- più occurrence: scelta esplicita richiesta all'autore;
- nessuna occurrence: contenuto contestuale, senza tappa inventata;
- contenuto aggiunto dentro uno stop: quello stop è il `deliveryAnchor`.

La route review usa VenueRelease e Layout pubblicati. Un percorso indoor non raggiungibile produce un blocker che rimanda a `Spazi e mappa`; la Visit non modifica il Layout. I trasferimenti inter-Venue richiedono una stima esplicita e non vengono inventati dal sistema.

Lo stesso route review partecipa al consistency check autorevole e può bloccare review/pubblicazione della Visit.

## Navigator — Physical Domain integration

Le azioni fisiche Navigator sono `AvailableAction` generate dalle definition del PhysicalVocabulary pinzato. Label e controlled-voice aliases provengono dal vocabulary; non esiste una enum globale di facility ArtAround.

L'esecuzione fisica riusa lo stesso routing locale e gli stessi `PhysicalFeatureRef` risolti dal backend. MapProjection e navigation projection derivano dagli snapshot VenueRelease/Layout pinzati alla Session.

Il runtime Action protocol resta l'unico command boundary della Session. I canali supportati includono `button`, `controlled_voice`, `natural_language` e `system`; un futuro resolver NL/LLM dovrà scegliere una delle `AvailableAction` correnti e inviarne l'`actionId`, senza costruire azioni fisiche arbitrarie.

### Hook location / QR

Il dominio client definisce una posizione logica provider-neutral (`LogicalLocation`) e una `LocationObservation`; le capability di localizzazione producono osservazioni logiche e non espongono QR/GPS/raw sensor data come modello centrale.

È disponibile un adapter session-bound che risolve il `VenueTarget.publicCode` contro la VenueRelease/Layout pinzata dalla Session e restituisce soltanto la posizione logica corrispondente. La risoluzione non modifica la Session e non afferma automaticamente che l'utente si trovi in quel punto.

Scanner QR, geolocalizzazione, orientation e image-based localization restano fuori dall'incremento immediato; l'architettura è predisposta a integrarli come provider intercambiabili.

## Predisposizione fasce successive

Il redesign evita dipendenze che ostacolerebbero:

- sessioni sincronizzate docente/studenti e quiz;
- QR/geolocalizzazione;
- routing multi-Venue;
- natural language/LLM;
- traduzione e generazione dinamica di visite.

Queste feature non vengono considerate implementate solo perché esistono i relativi hook architetturali.

## Verifica

La fase di test del redesign è intenzionalmente separata. In questo stato non si dichiara una nuova suite green, una build verificata o CI green per il branch `codex/physical-domain-redesign`.

Le verifiche eseguite durante il redesign corrente sono audit statici dei contratti, delle dipendenze e dei boundary coinvolti. Test obsoleti o non ancora riallineati saranno trattati nella fase dedicata, insieme a build, seed verification e CI.

## Integrazione con `main`

Il branch deve essere riconciliato con gli aggiornamenti successivi di `main` prima della merge finale. La riconciliazione deve preservare le modifiche Marketplace introdotte nel frattempo e risolvere semanticamente i file condivisi; non va effettuata mantenendo contratti fisici legacy per ridurre i conflitti.
