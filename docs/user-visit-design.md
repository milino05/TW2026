# User e Visit: decisioni implementate e punti aperti

Questo documento descrive il perimetro del branch `user-visit`.

## Implementato

### User

- `username` univoco e normalizzato.
- `passwordHash` non selezionato nelle query ordinarie.
- `memberships` contestuali a un museo.
- ruolo iniziale `operator`.
- uno stesso museo non puo comparire due volte nelle membership dello stesso utente.
- stato utente `active` o `disabled`.

Qualunque utente attivo puo essere autore di una visita community. Per gestire una visita ufficiale e necessaria una membership `operator` relativa al museo proprietario.

### Visit

Un'unica collezione gestisce:

- visite `official`, con `ownerMuseumId` obbligatorio;
- visite `community`, senza `ownerMuseumId` e potenzialmente multi-museo.

Le tappe sono ordinate esclusivamente dalla posizione nell'array `stops`. Non esiste un secondo campo `order`.

Ogni tappa contiene l'item principale. Le rappresentazioni alternative e gli approfondimenti su autore, stile, periodo e altri argomenti restano nel modello Item e nel grafo delle relazioni; non diventano tappe della visita.

`museumIds` e un campo denormalizzato derivato dagli item delle tappe, usato per ricercare le visite community che coinvolgono uno specifico museo.

La pubblicazione verifica:

- esistenza e stato attivo del creatore;
- membership dell'operatore per le visite ufficiali;
- esistenza del museo proprietario;
- esistenza degli item;
- appartenenza di tutti gli item al museo proprietario per una visita ufficiale;
- stato `published` e integrita `valid` di tutti gli item;
- presenza di almeno una tappa.

Il servizio `visitIntegrity.service.js` richiede esplicitamente `actorUserId`. Il modo in cui tale identita viene ottenuta dalla richiesta HTTP non e stato deciso in questo branch.

### Language level e duration

I language level sono ora oggetti ordinati:

```json
{
  "key": "simple",
  "label": "Semplice",
  "level": 1,
  "description": "Lessico comune e frasi brevi"
}
```

Sia per `languageLevels` sia per `durationTypes` devono essere univoci:

- `key`;
- `level`.

I valori non devono essere consecutivi: e sufficiente che l'ordine numerico sia univoco. Il vocabolario restituisce:

- `languageLevels`: array delle key, per compatibilita con le representations esistenti;
- `languageLevelTypes`: array completo e ordinato, per il Navigator.

## Punti volutamente non implementati

### Autenticazione HTTP

Non sono stati aggiunti login, sessioni, JWT o middleware di autenticazione. Prima di esporre le API di scrittura delle visite va scelta una strategia.

### CRUD e route delle visite

Non sono stati montati controller e route per creare o modificare visite, perche senza autenticazione non e definito in modo affidabile come ottenere `actorUserId` e impedire l'impersonificazione.

### Presentazione iniziale della tappa

Non e stato deciso se una tappa debba salvare:

1. una policy (`languageLevelKey` e `durationKey`);
2. un riferimento rigido a una representation;
3. nessuna preferenza, usando le preferenze del visitatore.

### Moderazione community

Non e stato deciso se la pubblicazione community sia diretta oppure richieda `pending_review`.

### Visibilita e ritiro

Non sono stati introdotti `private`, `unlisted`, `archived` o un flusso di unpublish.

### Logistica

Le indicazioni indoor e i trasferimenti tra musei non sono inclusi in questo branch. Il loro modello deve rimanere separato dagli item, ma la struttura definitiva non e stata concordata.

### Migrazione dei language level esistenti

Il vecchio formato era un array di stringhe. Prima del deploy occorre scegliere esplicitamente la mappatura delle stringhe esistenti verso `key`, `label` e soprattutto `level`. Il branch non assume automaticamente che l'ordine corrente dell'array sia quello semantico corretto.
