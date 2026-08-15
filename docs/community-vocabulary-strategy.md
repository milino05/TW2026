# Strategia definitiva per i vocabolari delle visite community

## Principio

Ogni museo mantiene un vocabolario autonomo. Le chiavi e le etichette di musei diversi non vengono mai confrontate direttamente: `simple`, `facile` e `base` possono avere significati editoriali differenti.

## Ordine e normalizzazione

L'ordine degli array `config.durationTypes` e `config.languageLevels` e l'unica gerarchia persistita. Il campo `level` non esiste.

Per un array di `n` elementi, la posizione relativa dell'elemento con indice `i` e:

```text
normalizedPosition = i / (n - 1)
```

Con un solo elemento la posizione convenzionale e `0.5`. Il valore viene calcolato dal vocabulary service e non viene salvato in MongoDB.

Esempio con quattro livelli:

```text
0, 0.333..., 0.666..., 1
```

La normalizzazione usa sempre l'intero vocabolario del museo. Le representation disponibili in un singolo item non vengono rinormalizzate.

## Durata nominale

Ogni `DurationType` richiede `targetSeconds`, intero positivo e crescente seguendo l'ordine dell'array.

```json
{
  "key": "medium",
  "label": "Media",
  "description": "Descrizione dei principali aspetti dell'opera",
  "targetSeconds": 90
}
```

`targetSeconds` e una stima editoriale della narrazione a velocita standard. Non include spostamenti, interazioni, pause o approfondimenti richiesti durante la visita.

## Preferenze astratte

Una visita community usa valori indipendenti dai vocabolari locali:

```json
{
  "depthPreference": 0.7,
  "languageComplexityPreference": 0.3
}
```

Per ogni tappa il backend:

1. recupera il vocabolario del museo dell'item;
2. calcola le posizioni relative delle duration e dei language level;
3. considera soltanto le representation realmente disponibili;
4. calcola la distanza Manhattan;
5. seleziona la representation con distanza minima.

```text
distance =
  abs(durationPosition - depthPreference)
  + abs(languagePosition - languageComplexityPreference)
```

Tie-break:

1. linguaggio meno complesso;
2. durata piu vicina alla preferenza;
3. representation `isDefault`;
4. ordine originale delle representation.

Se i metadati non consentono il confronto, viene usata la representation `isDefault` dell'item.

## Preferenze persistite

`User.defaultPresentationPreference` contiene il default astratto globale.

`UserVisitPreference` contiene l'override della singola visita:

- visita ufficiale: `durationKey` e `languageLevelKey` del museo;
- visita community: `depthPreference` e `languageComplexityPreference`.

Precedenza community:

```text
preferenza custom della visita
-> preferenza globale dell'utente
-> default locale dell'item
```

## Stima temporale

Il piano di presentazione somma i `targetSeconds` delle representation selezionate. Il campo restituito e `estimatedContentSeconds`, perche la logistica verra aggiunta separatamente in una fase successiva.

La stessa informazione potra essere riutilizzata dal futuro servizio di generazione automatica delle visite con vincolo di durata.

## Modifiche al vocabolario

Ogni modifica alla configurazione incrementa `Museum.vocabularyRevision`. Riordinare o cambiare i vocabolari puo modificare la representation scelta e la durata stimata delle visite community. Il backend marca quindi le visite coinvolte per il ricalcolo senza inventare equivalenze tra chiavi locali.
