# Dataset demo V3

## Scopo

`npm run seed:demo` popola il database vuoto con il dataset dimostrativo canonico di ArtAround. Il V3 sostituisce il vecchio seed operativo; `examDatasetV2.js` resta nel repository soltanto come fixture per test legacy che lo importano direttamente.

Il dataset è deterministico per le entità che crea e il verifier controlla gli invarianti rilevanti prima della demo.

## Account

Sono creati o riallineati i quattro account obbligatori:

- `autore1`
- `autore2`
- `visitatore1`
- `visitatore2`

Password comune: `12345678`.

## Organization e Venue

Il seed crea tre Organization indipendenti, ognuna con una Venue reale di Bologna:

| Organization / Venue | Owner demo | Tipologia | Sede |
| --- | --- | --- | --- |
| Pinacoteca Nazionale di Bologna | `autore1` | arte | Via delle Belle Arti 56, Bologna |
| MAMbo — Museo d'Arte Moderna di Bologna | `autore1` | arte moderna e contemporanea | Via Don Minzoni 14, Bologna |
| Museo Civico Archeologico di Bologna | `autore2` | archeologia | Via dell'Archiginnasio 2, Bologna |

Le mappe incluse nel Navigator sono schemi ArtAround originali dall'alto. Servono a provare sale, ExhibitSlot, routing e servizi e **non rappresentano planimetrie ufficiali** dei musei.

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

Sono pubblicate sei visite, tutte con almeno dieci tappe fisiche:

### Pinacoteca

1. **Capolavori della Pinacoteca** — self-guided.
2. **Dai Carracci al Seicento** — self-guided.
3. **Classe alla Pinacoteca** — sincronizzata, alias `FENICE ROSSA`, quiz finale.

### MAMbo

4. **Dal secondo Novecento al contemporaneo** — self-guided.
5. **Materia, gesto e politica** — self-guided.

### Museo Civico Archeologico

6. **Bologna antica: laboratorio di archeologia** — sincronizzata, alias `ATENA BLU`, quiz finale.

Le tre visite della Pinacoteca preservano il requisito minimo di tre visite da almeno dieci opere sullo stesso museo. Le due visite sincronizzate contengono cinque domande ciascuna.

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
- esattamente due Visit sincronizzate con alias e quiz;
- tre visite della Pinacoteca;
- Listing e Offer attive per tutte le visite.

## Riferimenti usati per i dati demo

Le sedi e una parte dei contenuti sono stati verificati su fonti museali/istituzionali durante la preparazione del dataset. Il seed non pretende di essere un catalogo scientifico completo: i testi sono contenuti dimostrativi ArtAround progettati per esercitare adattamento, relazioni semantiche e visita.

Riferimenti principali:

- Pinacoteca Nazionale di Bologna: materiale e guide del museo, `pinacotecabologna.beniculturali.it`;
- MAMbo / Museo Morandi: Istituzione Bologna Musei e Comune di Bologna, `museibologna.it` e `comune.bologna.it`;
- Museo Civico Archeologico di Bologna: catalogo online e schede del museo, `museibologna.it/archeologico`.
