# Visite community e vocabolari locali

## Problema

Ogni museo controlla il proprio vocabolario. Di conseguenza, chiavi ed etichette come:

- `simple`;
- `facile`;
- `base`;
- `short`;
- `rapida`;

non sono confrontabili automaticamente tra musei diversi. Anche quando due etichette sembrano sinonimi, il loro significato editoriale puo essere differente.

Una visita ufficiale non presenta questo problema: tutti gli item appartengono allo stesso museo e la policy della visita usa direttamente le chiavi del suo vocabolario.

## Comportamento implementato

### Visita ufficiale

La visita contiene una policy globale:

```json
{
  "defaultPresentationPolicy": {
    "durationKey": "medium",
    "languageLevelKey": "simple"
  }
}
```

La policy viene validata contro il vocabolario del museo proprietario e deve essere supportata da tutte le tappe.

### Visita community

La visita non contiene una policy globale. Ogni tappa parte dalla representation `isDefault` dell'item corrispondente.

Per pubblicare un item e ora obbligatorio avere esattamente una representation di default. Questo garantisce che una visita community sia sempre eseguibile senza confrontare vocabolari diversi.

Le preferenze custom cross-museum non vengono ancora interpretate. Il backend restituisce un errore esplicito invece di applicare equivalenze silenziose.

## Strategie considerate per l'adattamento

### 1. Confronto delle chiavi o delle etichette

Esempio: trattare `simple`, `semplice` e `facile` come equivalenti.

Vantaggi:

- implementazione apparentemente semplice.

Svantaggi:

- dipende dalla lingua e dalla scelta dei nomi;
- produce falsi equivalenti;
- non rispetta realmente l'autonomia editoriale del museo;
- e fragile quando il vocabolario cambia.

Valutazione: sconsigliata.

### 2. Vocabolario globale obbligatorio

Ogni museo deve usare le stesse categorie globali.

Vantaggi:

- confronto diretto;
- interfaccia semplice.

Svantaggi:

- elimina la liberta richiesta ai musei;
- rende la configurazione locale quasi nominale.

Valutazione: incompatibile con il requisito.

### 3. Mappatura esplicita verso categorie canoniche

Ogni livello locale dichiara una categoria comune, ad esempio:

```json
{
  "key": "facile",
  "level": 2,
  "canonicalBand": "simple"
}
```

Vantaggi:

- mapping semantico esplicito e controllato dal museo;
- comportamento deterministico;
- chiavi ed etichette locali restano libere.

Svantaggi:

- introduce comunque una tassonomia condivisa;
- richiede ai manager del museo di classificare ogni voce;
- una categoria globale puo non descrivere bene tutti i casi locali.

Valutazione: solida se si accetta un contratto semantico minimo comune.

### 4. Posizione relativa nel vocabolario locale

La preferenza dell'utente non contiene una chiave, ma una posizione astratta tra 0 e 1.

Esempio:

```json
{
  "durationPreference": 0.75,
  "languageComplexityPreference": 0.25
}
```

Per ogni museo:

1. le voci vengono ordinate mediante `level`;
2. ogni posizione viene normalizzata rispetto alla dimensione del vocabolario;
3. viene scelta la voce locale piu vicina;
4. per l'item viene selezionata la representation disponibile piu vicina.

Vantaggi:

- nessun confronto tra etichette;
- nessuna chiave globale obbligatoria;
- conserva la liberta del museo;
- funziona anche con numeri differenti di livelli.

Svantaggi:

- assume che la posizione relativa abbia un significato comparabile;
- il secondo livello di un vocabolario a tre voci non equivale necessariamente al secondo livello di un vocabolario a cinque voci;
- serve una regola di fallback quando manca la coppia desiderata nell'item.

Valutazione: migliore compromesso per il progetto, ma e un adattamento approssimato, non un'equivalenza semantica.

### 5. Policy esplicita per ogni tappa

Il creatore community seleziona una representation iniziale specifica per ogni item.

Vantaggi:

- risultato editoriale preciso;
- nessuna equivalenza tra musei.

Svantaggi:

- non adatta automaticamente la visita al compratore;
- aumenta il lavoro del creatore;
- le scelte possono diventare invalide se le representation cambiano.

Valutazione: utile come override editoriale, non sufficiente da sola per la personalizzazione.

## Raccomandazione

Adottare un modello ibrido:

1. default garantito: ogni tappa community usa la representation `isDefault` locale;
2. preferenze utente astratte: durata e complessita sono memorizzate come valori normalizzati indipendenti dalle chiavi dei musei;
3. risoluzione locale: il Navigator usa l'ordine `level` del museo dell'item corrente;
4. fallback esplicito: se la combinazione non esiste, si sceglie la representation disponibile con distanza minima oppure si torna al default locale;
5. nessuna equivalenza per nome: `facile` e `semplice` non vengono mai associate tramite string matching.

## Decisioni ancora richieste

Prima di implementare l'adattamento occorre scegliere:

1. se la preferenza normalizzata e globale per l'utente oppure specifica per la visita acquistata;
2. se il fallback sceglie la representation piu vicina o torna sempre al default locale;
3. se il creatore community puo impostare un override per singola tappa;
4. se aggiungere una `canonicalBand` opzionale per migliorare il mapping relativo quando il museo desidera dichiararla.
