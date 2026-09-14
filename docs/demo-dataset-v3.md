# Dataset demo V3

## Scopo

`npm run seed:demo` popola il database con il dataset dimostrativo canonico di ArtAround. Il V3 resta il generatore strutturale di fallback; quando è presente una snapshot canonica completa in `scripts/fixtures/demo-database/`, `seed:demo` ripristina invece quella snapshot e poi esegue lo stesso verifier.

Questo permette di usare l'applicazione e i suoi editor per rifinire il dataset demo, congelare lo stato approvato e rigenerarlo successivamente senza trascrivere manualmente modifiche tra database e seed.

## Snapshot canonica completa

Per congelare lo stato corrente del database locale:

```bash
npm run snapshot:demo-db
```

Se lo sviluppo locale usa `docker compose`, usare invece:

```bash
npm run snapshot:demo-db:docker
```

Il wrapper Docker arresta temporaneamente il backend se era in esecuzione, in modo da evitare scritture concorrenti durante la cattura, usa lo stesso Mongo e gli stessi named volume del backend, e al termine riavvia il backend se necessario.

La snapshot contiene:

- tutte le collection MongoDB applicative presenti nel database;
- tutti i documenti, preservando i tipi BSON tramite Extended JSON canonico;
- opzioni delle collection e indici ricreabili;
- eventuali view MongoDB;
- l'intero contenuto degli upload `item-media`;
- l'intero contenuto degli upload `venue-floor-plans`;
- l'intero contenuto degli upload `venue-recognition-media`;
- checksum SHA-256 dei file esportati.

La sola eccezione documentale è la collection `sessions`: la collection e i suoi indici vengono preservati, ma i documenti di sessione non vengono versionati perché contengono stato di autenticazione runtime (`tokenHash`, user agent e indirizzo IP) e non appartengono al dataset dimostrativo. Dopo il seed la collection è quindi vuota.

I file prodotti sono sotto:

```text
scripts/fixtures/demo-database/
├── manifest.json
├── collections/
└── assets/
    ├── item-media/
    ├── venue-floor-plans/
    └── venue-recognition-media/
```

Questa directory deve essere committata insieme al codice quando la snapshot viene approvata come nuova fonte canonica del dataset.

## Ripristino

Quando `scripts/fixtures/demo-database/manifest.json` esiste, `npm run seed:demo`:

1. elimina tutte le collection applicative correnti dal database selezionato;
2. ricrea le collection, i documenti, gli indici e le view della snapshot;
3. ripristina gli alberi di upload e ne verifica i checksum;
4. esegue `verifyExamDatasetV3()` sul risultato ricostruito.

In sviluppo Docker usare:

```bash
npm run seed:demo:docker
```

Questo è necessario affinché gli asset vengano ripristinati nei named volume realmente usati dal backend. Sul deploy di dipartimento, dove Node e directory di upload appartengono allo stesso filesystem della consegna, resta sufficiente `npm run seed:demo`.

Se la snapshot non esiste, `seed:demo` usa il generatore V3 storico. Questo mantiene la CI funzionante anche prima della prima cattura del database golden master.

## Account

Sono presenti i quattro account obbligatori:

- `autore1`
- `autore2`
- `visitatore1`
- `visitatore2`

Password comune: `12345678`.

## Organization e Venue

Il dataset contiene tre Organization indipendenti, ognuna con una Venue reale di Bologna:

| Organization / Venue | Owner demo | Tipologia | Sede |
| --- | --- | --- | --- |
| Pinacoteca Nazionale di Bologna | `autore1` | arte | Via delle Belle Arti 56, Bologna |
| MAMbo — Museo d'Arte Moderna di Bologna | `autore1` | arte moderna e contemporanea | Via Don Minzoni 14, Bologna |
| Museo Civico Archeologico di Bologna | `autore2` | archeologia | Via dell'Archiginnasio 2, Bologna |

Le mappe incluse nel dataset sono materiale dimostrativo ArtAround e non rappresentano planimetrie ufficiali dei musei.

## Regole editoriali

Pinacoteca e MAMbo usano la struttura del modello culturale starter corrente di ArtAround:

- durate: `Breve`, `Media`, `Approfondita`;
- livelli: `Semplice`, `Divulgativo`, `Specialistico`;
- tipi di soggetto: opera/bene culturale, persona/autore, contesto storico-culturale, materiale/tecnica;
- relazioni: `Creata da`, `Contesto storico e culturale`, `Tecnica e esecuzione`.

Il Museo Civico Archeologico usa un Namespace dedicato:

- 2 durate: `Essenziale`, `Approfondita`;
- 2 livelli: `Accessibile`, `Specialistico`;
- 3 relazioni: `Appartiene al contesto`, `Realizzato in`, `Reperto correlato`.

Ogni Item pubblicato contiene una sola PresentationVariant adattiva con l'intera matrice cartesiana durata × livello di linguaggio. Per i musei d'arte sono quindi presenti 9 Representation per Item; per l'Archeologico 4. Tutte hanno testo non vuoto, autore e licenza.

## Contenuti e grafo semantico

Ogni museo contiene 12 soggetti fisici principali, più soggetti di approfondimento. Tutti i Subject presenti nel grafo hanno almeno un Item pubblicato nella stessa EditorialRelease.

Il dataset è costruito affinché ogni Subject abbia almeno due collegamenti incidenti nel grafo. Le opere d'arte sono collegate ad autore, contesto e tecnica; i reperti archeologici a contesto, materiale e a un reperto correlato.

Questa struttura mantiene separati:

- `Subject`, `Item`, `ContentSpace`, `EditorialContext` e SemanticGraph per il dominio editoriale;
- `VenueTarget`, `ExhibitSlot`, `LayoutRevision` e `VenueRelease` per il dominio fisico;
- indicazioni logistiche e routing, che non diventano Item.

## Visite

Sono pubblicate sei Visit, tutte con almeno dieci tappe fisiche. Nessuna `VisitRevision` è classificata come self-guided o synchronized: la modalità viene scelta nel Navigator tramite `ExecutionPreparation.executionMode`.

### Pinacoteca

1. **Capolavori della Pinacoteca** — Visit senza configurazione di gruppo predefinita.
2. **Dai Carracci al Seicento** — Visit senza configurazione di gruppo predefinita.
3. **Classe alla Pinacoteca** — predisposta anche per uso di gruppo, nome suggerito `FENICE ROSSA`, quiz finale di cinque domande.

### MAMbo

4. **Dal secondo Novecento al contemporaneo** — Visit senza configurazione di gruppo predefinita.
5. **Materia, gesto e politica** — Visit senza configurazione di gruppo predefinita.

### Museo Civico Archeologico

6. **Bologna antica: laboratorio di archeologia** — predisposta anche per uso di gruppo, nome suggerito `ATENA BLU`, quiz finale di cinque domande.

Le tre Visit della Pinacoteca preservano il requisito minimo di tre visite da almeno dieci opere sullo stesso museo. Le due Visit predisposte per l'uso di gruppo restano avviabili anche personalmente: alias e quiz sono configurazioni editoriali opzionali, non una modalità della Visit.

## Verifica

```bash
npm run seed:demo
npm run verify:demo
```

Il verifier controlla almeno:

- account e password;
- tre Organization e ownership attesa;
- cardinalità e validità dei Namespace;
- matrice completa durata × linguaggio per ogni Item;
- Item per ogni Subject del grafo;
- almeno due collegamenti per Subject;
- 12 VenueTarget e 12 ExhibitSlot per Venue;
- map asset e integrità VenueRelease;
- sei Visit pubblicate, tutte con almeno dieci contenuti distinti;
- esattamente due Visit demo predisposte per uso di gruppo con nome suggerito e quiz;
- assenza di `deliveryMode`/`synchronization` dalle VisitRevision;
- tre visite della Pinacoteca;
- Listing e Offer attive per tutte le visite.

## Riferimenti usati per i dati demo

Le sedi e una parte dei contenuti sono stati verificati su fonti museali/istituzionali durante la preparazione del dataset. Il seed non pretende di essere un catalogo scientifico completo: i testi sono contenuti dimostrativi ArtAround progettati per esercitare adattamento, relazioni semantiche e visita.

Riferimenti principali:

- Pinacoteca Nazionale di Bologna: materiale e guide del museo, `pinacotecabologna.beniculturali.it`;
- MAMbo / Museo Morandi: Istituzione Bologna Musei e Comune di Bologna, `museibologna.it` e `comune.bologna.it`;
- Museo Civico Archeologico di Bologna: catalogo online e schede del museo, `museibologna.it/archeologico`.
