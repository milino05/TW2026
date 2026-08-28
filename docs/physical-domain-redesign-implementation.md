# Physical Domain redesign — implementation status

Questo documento descrive lo stato del codice di produzione del redesign Physical Domain sul branch `codex/physical-domain-redesign`.

La baseline architetturale è il redesign approvato del 2026-08-27. Questo file non sostituisce le specifiche ufficiali: registra ciò che il branch implementa e separa esplicitamente implementazione da verifica.

## Stato

**Implementazione applicativa: completa.**

Backend, dominio, API, Marketplace, Venue authoring, Visit authoring e Navigator sono stati portati al modello Physical Domain approvato. Non risultano ulteriori feature o refactoring di produzione necessari per chiudere questa fase.

**Verifica: intenzionalmente pendente.**

Test automatici, aggiornamento dei test che dipendevano dai contratti rimossi, build/typecheck dei client, prove runtime e CI non sono dichiarati eseguiti da questo documento. Sono il solo lavoro residuo prima di considerare la fase verificata e chiusa.

## 1. PhysicalVocabulary

È implementata una risorsa autonoma e versionata, posseduta da utente o Organization, con:

- working revision e published revision;
- `placeTypes`, `connectionTypes`, `physicalAttributes`, `routingProfiles`;
- UUID locali `definitionId`;
- alias/localizzazioni separati dai `semanticRefs`;
- starter ArtAround non distruttivo;
- fork con rigenerazione degli UUID locali e remapping dei profili;
- review, publish, integrity e lifecycle;
- RBAC Organization;
- distribuzione Marketplace e acquisizione per snapshot;
- editor Marketplace, tutorial e accessi da profilo/Organization.

Non esiste un'ontologia fisica globale ArtAround. Il core non dipende da `canonicalKey`, cataloghi globali di attributi o intent hardcoded come toilette/uscita.

## 2. Layout e VenueRelease

`LayoutRevision` pinna una `PhysicalVocabularyRevision` precisa tramite `authoredAgainstPhysicalVocabularyRevisionId` e contiene soltanto stato concreto della Venue:

- floors;
- Place con `placeTypeDefinitionId`;
- Connection con `connectionTypeDefinitionId`;
- attribute values tipizzati;
- geometria delle Connection;
- metric mode `geometry_derived`, `length_constrained`, `manual_override`;
- calibrazione;
- VenueTarget placement.

Il layout non contiene più `placeTypes`, `routingAttributes` o `routingPresets` propri.

Il vecchio percorso di riscrittura dell'aggregate è stato eliminato dal codice di produzione: non esiste più `PATCH /venues/:venueId/working-release`, né il relativo client method, controller, service o validator. Il frontend modifica lo stato fisico esclusivamente attraverso command applicativi granulari e il backend rimane autoritativo.

## 3. Marketplace PhysicalVocabulary UX

Sono implementati:

- editor autonomo con sezioni Generale, Tipi di luogo, Tipi di collegamento, Caratteristiche fisiche, Profili di percorso e Mapping esterni;
- tutorial facoltativo e riapribile;
- starter non distruttivo;
- workflow di consistenza/review/pubblicazione;
- primo onboarding Venue con vocabulary esistente, starter o blank;
- accesso da account personale, Organization, Workspace e Venue;
- rotta SPA `/physical-vocabularies/editor` registrata esplicitamente.

## 4. Venue visual editor

La IA è:

1. Panoramica;
2. Oggetti;
3. Spazi e mappa;
4. Informazioni visitatori;
5. Pubblicazione.

`Spazi e mappa` usa command discreti per:

- aggiungere/rinominare/rimuovere piani;
- caricare planimetrie come managed asset;
- calibrare;
- creare, spostare e modificare Place;
- creare e modificare Connection e polilinee;
- gestire distanza e metric mode;
- valorizzare attributi fisici tipizzati;
- collocare VenueTarget;
- mostrare diagnostica e blocker di integrità.

L'editor tecnico precedente basato su JSON, technical key, `canonicalKey`, array di vocabolario dentro il Layout e mega-snapshot frontend non fa più parte del codice di produzione.

## 5. VenueTarget e media fisici

`VenueTarget` resta distinto da `Subject`, `Item` e `Place`.

Sono implementati:

- `publicCode` stabile;
- creazione object-first da Subject;
- placement indipendente;
- availability nella VenueRelease;
- recognition media come metadati fisici managed, non media editoriali dell'Item;
- detach atomico dalla working configuration;
- cleanup degli asset solo quando non referenziati da snapshot storici/pubblicati.

Il trash di un VenueTarget è bloccato finché il target è referenziato dalla working configuration, dalla configurazione pubblicata o dalla revisione pubblicata corrente di una Visit attiva. Eliminare la presenza fisica non elimina Subject o Item.

## 6. Lifecycle e rimozione risorse

### PhysicalVocabulary

La rimozione Workspace:

- cestina la lineage;
- ritira le Listing interessate;
- rende inattive le Offer;
- conserva revisioni, Acquisition, Entitlement e Adoption;
- conserva l'uso di snapshot già pinzati da LayoutRevision.

Nuovo authoring richiede invece una lineage attiva. Il restore non ripubblica automaticamente la distribuzione Marketplace.

Il vecchio endpoint lifecycle di trash delega allo stesso use case coordinato, quindi non esistono percorsi che possano cestinare la risorsa lasciandola in vendita.

### Venue

Venue supporta impact, trash e restore. Il trash non esegue cascade su Release, Layout, Target o Visit. La UI dichiara prima dell'operazione il numero di VenueTarget e Visit pubblicate correnti coinvolte e fornisce feedback dopo la rimozione.

### Floor, Place e Connection

Sono elementi della working LayoutRevision, non risorse autonome. La loro rimozione resta un command di authoring soggetto agli invarianti del layout, senza introdurre lifecycle artificiali.

## 7. Routing e riferimenti federati

Il contratto pubblico di navigazione usa `PhysicalFeatureRef`:

- local ref per definizioni della vocabulary adottata;
- semantic ref per interoperabilità tra vocabulary.

Il resolver traduce i riferimenti semantic/federated nelle definizioni locali prima del routing. Il graph engine consuma attribute values locali e non conosce un catalogo fisico globale.

Sono implementate le priorità `required`, `preferred`, `avoid`, con blocker per i requirement necessari non risolvibili e warning per i soft requirement secondo il contratto.

I `RoutingProfile` sono selezionati per Venue e non vengono unificati per nome tra vocabulary differenti.

## 8. Visit authoring

Il modello persistente conserva `ContentEntry` e `VisitAnchor` separati; non è stata introdotta una nuova entità persistente VisitStop.

Sono implementati command applicativi per:

- aggiungere contenuto;
- aggiungere contenuto a uno stop;
- creare/riusare anchor;
- riordinare stop;
- attach/detach content↔stop;
- rimuovere contenuto o stop;
- configurare trasferimenti inter-Venue;
- route review.

La UI usa una proiezione stop-centric senza deformare il modello persistente. Il routing deriva da anchor → VenueTarget → placement → Place → graph. Problemi fisici vengono esposti come blocker da correggere nella Venue, non aggirati nell'editor Visit.

## 9. Navigator

Il Navigator usa:

- `PhysicalFeatureRef` invece del vecchio `attributeKey` globale;
- profili di routing per Venue;
- controlli boolean, number e choice derivati dal PhysicalVocabulary;
- priorità preferred/avoid/required;
- `ReliableSelect` mantenendo la semantica del nuovo Physical Domain;
- preparation/esecuzione basate su VenueRelease/LayoutRevision pubblicate;
- primitive di location e routing predisposte per QR/localizzazione e futuri input naturali.

## 10. Asset e deploy

Le planimetrie e i recognition media usano storage gestito e volumi Docker persistenti distinti dagli Item media. La pulizia degli asset è reference-aware per non rompere revisioni pubblicate o storiche.

I dataset demo/esame creano un PhysicalVocabulary pubblicato basato sullo starter e costruiscono i Layout usando i relativi `definitionId`, senza mantenere un secondo modello fisico legacy.

## 11. Cleanup architetturale completato

Sono stati rimossi dal codice di produzione i principali percorsi incompatibili con il redesign:

- vocabulary fisica embedded nel Layout;
- `routingAttributeCatalog.service.js` e cataloghi globali equivalenti;
- vecchi mixin Venue per snapshot/routing tecnico;
- authoring basato su `placeTypes`, `routingAttributes`, `routingPresets` del Layout;
- raw rewrite `PATCH /venues/:venueId/working-release`;
- validator e client method del raw rewrite;
- dipendenza Navigator da `attributeKey` per i requirement fisici.

Le nuove scelte sono protette dai contract-check esistenti e devono essere mantenute nei test aggiornati.

## Lavoro residuo prima della chiusura della fase

Non sono previste altre modifiche applicative salvo problemi scoperti dalla verifica. Restano esclusivamente attività di verifica:

1. aggiornare/rimuovere i test che esercitavano il vecchio raw VenueRelease snapshot API;
2. aggiungere o completare i test per lifecycle PhysicalVocabulary/Venue/VenueTarget e snapshot preservation;
3. eseguire i contract/static checks;
4. eseguire test backend e Mongo;
5. eseguire build/typecheck Marketplace e Navigator;
6. eseguire prove runtime dei flussi principali e seed;
7. eseguire CI e correggere eventuali regressioni emerse.

Solo dopo il completamento di queste verifiche la fase può essere dichiarata **verificata e chiusa**. Fino ad allora il codice è considerato **implementation-complete, verification-pending**.
