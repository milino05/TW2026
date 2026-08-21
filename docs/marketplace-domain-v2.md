# ArtAround — Marketplace Domain v2

Status: **Slice 11A design contract**.

Questo documento formalizza il sottodominio Marketplace del Domain Model v2. Estende la sezione `Commerciale e adozione` di `docs/domain-model-v2.md` senza sostituire gli altri invarianti del dominio.

Le specifiche ufficiali richiedono almeno: contenuti gratuiti/in vendita, licenza, prezzo, adozioni e vendite. Il modello seguente generalizza il Marketplace in modo coerente con ArtAround, permettendo la distribuzione sia di risorse per la fruizione sia di asset riusabili nel lavoro editoriale.

---

## 1. Obiettivo

Il Marketplace non e un semplice negozio di testi. E il boundary di distribuzione di asset ArtAround verso due categorie di uso:

1. **fruizione**: eseguire visite, generare visite da corpus curati, consumare contenuti;
2. **creazione**: usare contenuti, Namespace, Context o Visit esterni come sorgenti, template o basi di lavoro.

Un unico catalogo puo contenere entrambe le categorie. La differenza e determinata dalle capability concesse dall'Offer, non da due Marketplace separati.

Invariante fondamentale:

```text
ownership
!= license
!= MarketplaceListing
!= MarketplaceOffer
!= Acquisition
!= Entitlement
!= Adoption
!= ContentSpaceMembership
!= generator inclusion
```

---

## 2. Asset marketable

Il Marketplace puo riferirsi sia a lineages vive sia a snapshot immutabili.

### 2.1 Lineages vive

```text
item_edition
editorial_context
namespace
visit
```

Questi asset hanno una identita stabile e una versione/release pubblicata corrente.

### 2.2 Snapshot immutabili

```text
item_revision
editorial_release
namespace_revision
visit_revision
```

Questi asset identificano una versione precisa e non seguono aggiornamenti futuri.

### 2.3 Asset non marketable direttamente

Non sono asset Marketplace autonomi:

```text
ContentSpace
Item
Subject
SemanticGraphRevision
Venue
VenueTarget
VenueRelease
LayoutRevision
GeneratedVisitPlan
VisitSession
```

Motivazioni principali:

- `ContentSpace` e un workspace mutabile e puo contenere bozze o materiale non rilasciato;
- `Item` e namespace-neutral e non contiene da solo il payload presentazionale commercializzabile;
- `Subject` e identita culturale globale, non proprieta editoriale;
- il graph e distribuito come parte coerente di una `EditorialRelease`;
- Venue e infrastruttura fisica, non materiale editoriale Marketplace;
- GeneratedPlan e Session sono risultati/runtime personali, non prodotti editoriali.

Il sostituto corretto di un "ContentSpace in vendita" e:

```text
EditorialContext      # sorgente viva
EditorialRelease      # snapshot congelato
```

---

## 3. Live resource vs snapshot

Questa distinzione e normativa.

### 3.1 Coppie lineage -> snapshot

```text
ItemEdition      -> ItemRevision
EditorialContext -> EditorialRelease
Namespace        -> NamespaceRevision
Visit            -> VisitRevision
```

### 3.2 Version policy di un grant

Per un asset live, un OfferGrant puo avere:

```text
follow_current
pin_at_acquisition
```

Per un asset snapshot e ammesso soltanto:

```text
pinned
```

### 3.3 `follow_current`

Esempio:

```text
Entitlement
resource = EditorialContext C
capability = context.generate
versionPolicy = follow_current
```

All'acquisizione viene comunque risolta e registrata la snapshot corrente, ad esempio `EditorialRelease R12`, come baseline storica.

L'entitlement autorizza:

- la baseline R12;
- le successive EditorialRelease della stessa lineage pubblicate durante la validita dell'entitlement;
- l'uso futuro delle snapshot gia autorizzate quando esse sono state pinned da Visit/GeneratedPlan creati legittimamente.

Non significa "solo la release che e current in questo preciso istante".

Questo e necessario per evitare che:

```text
Piano P1 generato con R12
R13 diventa current
=> P1 smette di funzionare
```

Il comportamento corretto e:

```text
nuove generazioni -> possono usare R13
P1 gia materializzato -> continua a pin R12
```

### 3.4 `pin_at_acquisition`

Un grant su una lineage live viene risolto al momento dell'acquisizione e produce un entitlement alla snapshot corrente.

Esempio:

```text
OfferGrant
EditorialContext C
versionPolicy = pin_at_acquisition

acquisition time:
C.current = R12

Entitlement risultante:
EditorialRelease R12
versionPolicy = pinned
```

Non segue R13.

### 3.5 Delisting, variazione prezzo e lifecycle

Disabilitare un Listing/Offer o cambiarne il prezzo non modifica retroattivamente Acquisition ed Entitlement gia creati.

Una Acquisition conserva sempre i termini commerciali e la snapshot risolta al momento dell'acquisizione.

Un entitlement acquisito deve garantire almeno la snapshot acquisita, salvo una futura revoca/expiry esplicitamente modellata. Il semplice delisting commerciale non e revoca.

---

## 4. MarketplaceListing e MarketplaceOffer

Listing e Offer sono distinti perche lo stesso asset puo essere distribuito con pacchetti di diritti differenti.

### 4.1 MarketplaceListing

```text
MarketplaceListing
  id
  sellerType: user | organization
  sellerId
  primaryAsset
    resourceType
    resourceId
  title?
  summary?
  catalogMetadata?
  status: draft | published | withdrawn
```

Il `primaryAsset` e cio che l'utente riconosce come oggetto principale della scheda Marketplace.

### 4.2 MarketplaceOffer

```text
MarketplaceOffer
  id
  listingId
  label?
  pricing
    mode: free | paid
    amountMinor?
    currency?
  grants[]
  status: active | inactive
```

Un Listing puo avere piu Offer.

Esempio Visit:

```text
Offer A: gratis
  visit.execute

Offer B: 4 EUR
  visit.execute
  visit.copy_detached
```

Il prezzo viene memorizzato in minor units per evitare floating point monetario.

Non e richiesto un payment gateway reale per il dominio base: anche un'acquisizione gratuita o una vendita simulata genera una vera Acquisition applicativa.

---

## 5. OfferGrant

Un Offer non concede "proprieta" generica. Concede capability esplicite su risorse esplicite.

```text
OfferGrant
  resourceType
  resourceId
  capability
  versionPolicy
```

Un Offer puo contenere piu grant e quindi funzionare come bundle senza introdurre subito un aggregate `Bundle` universale.

Esempio:

```text
Listing: "Visita completa del Manierismo"

Offer:
  price = 4 EUR
  grants:
    - Visit V7 / visit.execute / follow_current
    - EditorialContext C1 / context.generate / follow_current
```

---

## 6. Capability matrix

Le capability sono type-safe: non tutte sono valide per tutti gli asset.

### 6.1 ItemEdition / ItemRevision

```text
content.consume
content.use_in_editorial_release
content.fork
```

Semantica:

- `content.consume`: leggere/fruire il contenuto nei limiti dell'entitlement;
- `content.use_in_editorial_release`: usare la Edition/Revision in un proprio processo editoriale, incluso il collegamento dell'Item al ContentSpace necessario alla pubblicazione;
- `content.fork`: creare una nuova Item lineage derivata, se i termini lo consentono.

`ContentSpaceMembership` da sola non prova il diritto commerciale: la pubblicazione di una propria EditorialRelease deve verificare ownership oppure entitlement appropriato sulla Edition/Revision usata.

### 6.2 EditorialContext / EditorialRelease

```text
context.generate
context.compose_visit
context.use_as_venue_primary
context.import_snapshot
```

Semantica:

- `context.generate`: usare il Context/Release come EditorialScope del generator;
- `context.compose_visit`: scegliere manualmente contenuti della release come source di una propria Visit senza copiarli nel proprio ContentSpace;
- `context.use_as_venue_primary`: consentire a una Organization autorizzata di adottare il Context come `Venue.primaryEditorialContextId`;
- `context.import_snapshot`: materializzare una copia editoriale detached a partire da una release precisa.

### 6.3 Namespace / NamespaceRevision

```text
namespace.author
namespace.fork
```

Semantica:

- `namespace.author`: usare il Namespace per creare proprie ItemEdition/EditorialContext;
- `namespace.fork`: creare una nuova Namespace lineage indipendente.

Modificare direttamente un Namespace esterno non e mai implicito.

### 6.4 Visit / VisitRevision

```text
visit.execute
visit.copy_detached
```

Semantica:

- `visit.execute`: avviare VisitSession sulla Visit/Revision autorizzata;
- `visit.copy_detached`: creare una nuova Visit lineage tramite il copy detached gia definito dal dominio.

### 6.5 Nessun diritto implicito di resale

L'acquisto non concede automaticamente:

```text
resell
redistribute
sublicense
```

Se in futuro servira distribuzione secondaria, sara una capability esplicita e separata.

---

## 7. Acquisition

`Acquisition` e l'evento commerciale immutabile.

```text
MarketplaceAcquisition
  id
  offerId
  listingId
  buyerType: user | organization
  buyerId
  sellerSnapshot
  pricingSnapshot
  grantSnapshots[]
  acquiredAt
```

Ogni `grantSnapshot` conserva almeno:

```text
requestedResourceRef
capability
versionPolicy
resolvedSnapshotRef
terms/license snapshot rilevante
```

Questo garantisce che una vendita a 2 EUR rimanga storicamente a 2 EUR anche se domani l'Offer costa 3 EUR.

Una acquisition `free` e comunque registrata: e necessaria per diritti, statistiche e adoption.

---

## 8. Entitlement

`Entitlement` e il diritto applicativo enforceable derivato da Acquisition, ownership o futuri grant amministrativi.

```text
Entitlement
  id
  beneficiaryType: user | organization
  beneficiaryId
  sourceAcquisitionId?
  resourceType
  resourceId
  capability
  versionPolicy: pinned | follow_current
  baselineSnapshotRef?
  validFrom
  validUntil?
  status: active | expired | revoked
```

Una Acquisition puo generare piu Entitlement.

L'authorization layer deve verificare capability, resource lineage e version scope; non deve dedurre il diritto dalla semplice presenza di una membership o dalla proprieta di un'altra risorsa.

---

## 9. Accesso tecnico alle dipendenze

Questa regola evita una esplosione di entitlement.

Un entitlement a una capability su un aggregate concede il **technical read/access alle dipendenze immutabili necessarie per eseguire quella capability**, ma non trasforma le dipendenze in asset riusabili autonomamente.

Esempio:

```text
EditorialRelease R12
  -> NamespaceRevision N7
  -> SemanticGraphRevision G9
  -> ItemRevision I1R4
  -> ItemRevision I2R6
```

`context.generate` su R12 permette al generator di leggere N7, G9, I1R4 e I2R6.

Non implica:

```text
content.use_in_editorial_release su I1
content.fork su I1
namespace.author su N7
```

Queste capability richiedono entitlement propri.

La stessa regola vale per Visit: `visit.execute` puo leggere le dipendenze editoriali necessarie all'esecuzione, nei limiti del dependency policy dell'Offer.

---

## 10. Dependency closure e authority del venditore

Una risorsa composita puo dipendere da asset commerciali che il seller non possiede.

Esempio:

```text
Visit V
  -> EditorialRelease A
  -> EditorialRelease B
```

Il seller della Visit non puo promettere automaticamente diritti di redistribuzione su A e B.

Prima di pubblicare un Offer va eseguito un `MarketplaceOfferIntegrity` che determina:

```text
selfContainedDependencies[]
externalRequirements[]
```

Regole iniziali conservative:

1. ownership/authority sul resource owner permette di creare Offer per quella risorsa;
2. un entitlement acquistato non concede resale/sublicense per default;
3. una dipendenza esterna puo essere:
   - coperta da un grant che il seller e autorizzato a distribuire;
   - dichiarata come `externalRequirement` che il buyer deve acquisire separatamente;
4. un Offer non puo dichiararsi self-contained se il seller non possiede l'authority necessaria.

Nel primo incremento implementativo e accettabile supportare soltanto seller-owned dependency closure per offerte self-contained e lasciare la redistribuzione avanzata a una futura estensione.

---

## 11. Adoption

`Adoption` non e acquisto e non e entitlement.

Definizione:

> Una Adoption registra che un creator ha realmente incorporato o utilizzato un asset esterno autorizzato dentro un proprio processo editoriale.

Non e un semplice "preferito" e non concede nuovi diritti.

```text
Adoption
  id
  beneficiaryType
  beneficiaryId
  entitlementId
  sourceResourceRef
  sourceSnapshotRef
  action
  targetResourceRef?
  resultResourceRef?
  adoptedAt
```

Azioni iniziali previste:

```text
content_link
content_fork
namespace_use
namespace_fork
context_reference
context_import
context_venue_primary
visit_copy
```

Esempi:

```text
ItemEdition acquisita
  -> content_link
  -> Item aggiunto a ContentSpace
```

```text
Namespace acquisito
  -> namespace_use
  -> nuovo EditorialContext del buyer usa quel Namespace
```

```text
EditorialContext acquisito
  -> context_reference
  -> viene usato come source esterna per generare/comporre Visit
```

```text
Visit acquisita
  -> visit_copy
  -> nuova Visit detached del buyer
```

L'Adoption e una registrazione/provenance dell'uso. Lo stato reale continua a vivere negli aggregate corretti (`ContentSpaceMembership`, `EditorialContext`, `Visit`, ecc.).

Rimuovere successivamente una membership non cancella la storia dell'adozione.

Le statistiche Marketplace possono distinguere:

```text
acquisitions/sales
adoptions
unique adopters
```

---

## 12. Reference, import, copy e fork

Questi concetti non sono sinonimi.

### 12.1 Reference / follow

Nessun nuovo aggregate editoriale viene creato.

```text
buyer
  -> Entitlement
  -> asset esterno live/snapshot
```

L'asset resta posseduto e mantenuto dal publisher originale.

Caso principale: `EditorialContext` live usato per generare nuove Visit sempre dalla release autorizzata piu recente.

### 12.2 Import snapshot

Materializza una base di lavoro locale detached da una snapshot immutabile.

Per `EditorialContext`:

```text
EditorialRelease sorgente
  -> nuovo ContentSpace del buyer
  -> nuovo EditorialContext del buyer
  -> membership agli Item consentiti
  -> graph iniziale copiato/provenanced
```

Non vengono copiati Subject.

Gli Item esterni rimangono esterni finche non vengono forkati.

Il Namespace puo essere riusato soltanto se il buyer possiede `namespace.author`; modificarlo richiede `namespace.fork`.

L'import non segue aggiornamenti futuri della sorgente.

### 12.3 Visit copy

Usa la semantica `copy detached` gia implementata:

- nuova Visit lineage;
- nuovi ID locali;
- structural sharing delle dipendenze immutabili autorizzate;
- nessun auto-sync futuro.

### 12.4 Fork

Crea una nuova lineage derivata e modificabile:

```text
ItemEdition/ItemRevision -> nuovo Item + Edition lineage
Namespace/Revision      -> nuovo Namespace lineage
```

Fork non significa import e non significa reference.

---

## 13. EditorialContext live come prodotto centrale

Caso di riferimento:

```text
EditorialContext C
"Corpus ufficiale Pinacoteca"
maintainer = Organization O

oggi:
C.publishedReleaseId = R12

domani:
C.publishedReleaseId = R13
```

Un buyer con:

```text
context.generate
follow_current
```

puo generare oggi da R12 e domani da R13.

Ogni GeneratedVisitPlan/Visit continua pero a pinzare la release usata:

```text
P1 -> R12
P2 -> R13
```

Questo consente di vendere/fornire un corpus curatoriale mantenuto da operatori qualificati senza trasferire ownership degli Item e senza perdere reproducibility delle Visit.

Lo stesso Context puo essere offerto con pacchetti differenti:

```text
Consumer Offer
  context.generate

Creator Offer
  context.generate
  context.compose_visit

Institution Offer
  context.generate
  context.compose_visit
  context.use_as_venue_primary
```

Un eventuale import detached richiede `context.import_snapshot`.

---

## 14. ItemEdition per creator

L'operazione Marketplace tipica non e "copia il testo nel mio DB".

Percorso preferito:

```text
acquire ItemEdition
  -> Entitlement content.use_in_editorial_release
  -> Adoption content_link
  -> underlying Item membership nel ContentSpace del buyer
  -> propria EditorialRelease puo bindare la Edition/Revision autorizzata
```

Se il buyer vuole modificare il contributo editoriale:

```text
content.fork
  -> nuova Item lineage
  -> stesso Subject quando semanticamente appropriato
  -> provenance sorgente
```

Questo preserva la separazione fra riuso e derivazione.

---

## 15. Namespace per creator

Un Namespace live con `namespace.author/follow_current` puo essere usato per nuove ItemEdition e EditorialContext.

Le revisioni gia authored restano pinzate alla propria `authoredAgainstNamespaceRevisionId`; una nuova published NamespaceRevision non le riscrive automaticamente.

`namespace.fork` produce invece una lineage indipendente con nuove definition identities secondo le regole del Domain Model v2.

---

## 16. Visit nel Marketplace

Una Visit puo essere distribuita almeno con:

```text
visit.execute
visit.copy_detached
```

La capability `visit.execute` e orientata alla fruizione.

La capability `visit.copy_detached` e orientata ai creator.

Il Marketplace deve mostrare le dependency requirements della Visit. Una Visit non deve apparire eseguibile se il buyer non possiede i diritti necessari alle dipendenze editoriali che l'Offer non include.

La physical infrastructure (`VenueTarget`, VenueRelease) non viene acquistata: le Venue pubblicate rimangono read-only physical infrastructure e la Session pinna la current VenueRelease secondo le normali regole runtime.

---

## 17. Catalogo consumer/creator

Non esistono due Marketplace separati.

Il catalogo puo offrire filtri/projection come:

```text
Per visitare
  - Visit con visit.execute
  - EditorialContext con context.generate

Per creare
  - ItemEdition con content.use_in_editorial_release/content.fork
  - EditorialContext con context.compose_visit/context.import_snapshot
  - Namespace con namespace.author/namespace.fork
  - Visit con visit.copy_detached
```

Questi sono read-model/UI concerns derivati dalle capability degli Offer.

---

## 18. Authorization integration points

L'implementazione commerciale deve sostituire policy temporanee gia isolate nel v2.

### Namespace

`namespaceUsageAuthorization.service` deve passare da:

```text
owner authority only
```

a:

```text
owner authority
OR entitlement namespace.author
```

### EditorialContext come Venue primary

`editorialContextUsageAuthorization.service` deve passare da:

```text
manage source ContentSpace
```

a:

```text
manage source ContentSpace
OR entitlement context.use_as_venue_primary
```

### Generator

Un Context esplicitamente richiesto deve essere usabile soltanto se l'utente ha ownership/authority oppure entitlement `context.generate` compatibile con la release risolta.

### Visit execution

`VisitSessionV2` deve verificare ownership/authority oppure `visit.execute`, insieme alla dependency closure necessaria.

### EditorialRelease publication

La release di un Context del buyer deve verificare per ogni ItemEdition esterna ownership oppure entitlement `content.use_in_editorial_release` valido per la ItemRevision bindata.

### Visit copy

La copy detached richiede ownership/authority oppure entitlement `visit.copy_detached` e non puo trasformare implicitamente dependency read rights in diritti di modifica sui contenuti.

---

## 19. License vs Marketplace grant

`ItemRevision.metadata.license` resta metadata editoriale/copyright della versione consumata.

Il Marketplace grant e invece la capability applicativa concessa dall'Offer.

Non bisogna fingere che una stringa di licenza arbitraria sia automaticamente machine-readable.

Regola iniziale conservativa:

- owner/authority della risorsa puo configurare i grant che il prodotto supporta;
- fork/redistribution devono essere concessi esplicitamente;
- future license policy machine-readable potra restringere/validare i grant senza cambiare Listing/Offer/Entitlement.

---

## 20. Cosa non implementiamo nella prima slice commerciale

Fuori scope iniziale:

- gateway Stripe/PayPal o transazioni bancarie reali;
- marketplace secondario/resale;
- revenue sharing multi-seller;
- subscription billing complesso;
- DRM;
- certificazione generica "verified author";
- visibility `public/private/unlisted` delle Visit;
- una gerarchia di ContentSpace;
- trasferimento automatico di ownership.

---

## 21. Decisioni finali Slice 11A

### M56 — Marketable assets

Marketable: ItemEdition/ItemRevision, EditorialContext/EditorialRelease, Namespace/NamespaceRevision, Visit/VisitRevision.

ContentSpace e gli aggregate fisici/runtime non sono marketable direttamente.

### M57 — Live vs snapshot

Le lineages vive possono essere offerte come `follow_current` oppure `pin_at_acquisition`; le snapshot sono sempre `pinned`.

### M58 — Listing vs Offer

`MarketplaceListing` descrive l'asset; uno o piu `MarketplaceOffer` descrivono prezzo e capability concesse.

### M59 — Acquisition vs Entitlement

Acquisition e lo snapshot commerciale immutabile. Entitlement e il diritto applicativo enforceable generato dai grant.

### M60 — Aggregate dependency access

Una capability su un aggregate concede accesso tecnico alle dipendenze immutabili necessarie all'operazione, ma non diritti autonomi di riuso/fork/resale su quelle dipendenze.

### M61 — Seller authority

Un seller non puo redistribuire diritti esterni implicitamente. Le dependency commerciali devono essere self-contained sotto authority valida oppure dichiarate come requirements esterni.

### M62 — Adoption

Adoption registra l'uso effettivo di un asset esterno nel processo editoriale del creator. Non concede diritti e non equivale a membership o generator inclusion.

### M63 — Reference/import/copy/fork

Sono quattro operazioni distinte:

- reference = usa l'asset esterno;
- import = materializza una snapshot detached;
- copy = nuova Visit detached;
- fork = nuova lineage derivata modificabile.

### M64 — EditorialContext live

`EditorialContext` e un first-class Marketplace product: un entitlement `follow_current` puo fornire un corpus curatoriale continuamente aggiornato, mentre ogni GeneratedPlan/Visit continua a pinzare la EditorialRelease effettivamente usata.

---

## 22. Conseguenza per la prossima slice implementativa

La prima implementazione deve partire dal commercial core, non da shortcut per singolo tipo di asset:

```text
MarketplaceAssetRef / resolver
MarketplaceListing
MarketplaceOffer
MarketplaceAcquisition
Entitlement
Adoption
MarketplaceOfferIntegrity
MarketplaceAuthorization
```

Poi vanno migrati i policy boundary gia esistenti e aggiunti i controlli su generator, EditorialRelease, Visit copy/execution e Namespace usage.

La UI Marketplace verra costruita sopra projection consumer/creator e non dovra conoscere i dettagli interni di Mongoose o della risoluzione live/snapshot.
