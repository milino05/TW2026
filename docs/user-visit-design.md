# User, Museum, Visit e presentazione adattiva

Questo documento descrive il perimetro implementato nel branch `user-visit` e le decisioni ancora aperte.

## User e autenticazione

Il modello User contiene:

- `username` univoco e normalizzato;
- `passwordHash` scrypt, escluso dalle query ordinarie;
- `memberships` contestuali a un museo;
- ruoli `operator` e `manager`;
- stato `active` o `disabled`.

L'autenticazione usa sessioni server-side in MongoDB e cookie HttpOnly. L'identita dell'attore deriva esclusivamente dalla sessione e non viene mai accettata dal body.

Endpoint disponibili:

- `POST /api/auth/register`;
- `POST /api/auth/login`;
- `POST /api/auth/logout`;
- `GET /api/auth/me`.

La registrazione crea un utente senza membership museali.

## Museum e gerarchia dei ruoli

Qualunque utente autenticato puo creare un museo. Il creatore viene aggiunto automaticamente alle membership con ruolo `manager` e il museo memorizza `createdBy`.

Gerarchia:

- utente normale: visite community e future operazioni marketplace;
- operator: privilegi utente piu creazione di item e visite ufficiali nel proprio museo;
- manager: eredita i privilegi operator e amministra museo, configurazione e ruoli.

Solo un manager puo:

- modificare nome o configurazione del museo;
- assegnare o cambiare il ruolo di un utente;
- eliminare il museo, se non esistono item o visite associati.

Endpoint:

```text
PUT /api/museums/:museumId/members/:userId/role
```

Payload:

```json
{
  "role": "operator"
}
```

oppure:

```json
{
  "role": "manager"
}
```

Il sistema impedisce di declassare l'ultimo manager attivo del museo.

Comando amministrativo equivalente:

```bash
npm run assign:museum-role -- <username> <museumId> <operator|manager>
```

## Visit

Un'unica collezione gestisce:

- visite `official`, con `ownerMuseumId` obbligatorio;
- visite `community`, senza `ownerMuseumId` e potenzialmente multi-museo.

Le tappe sono ordinate esclusivamente dalla posizione nell'array `stops`. Non esiste un secondo campo `order`.

Ogni tappa contiene l'item principale. Le rappresentazioni alternative e gli approfondimenti su autore, stile, periodo e altri argomenti restano nel modello Item e nel grafo delle relazioni; non diventano tappe della visita.

`museumIds` e derivato dagli item delle tappe e consente di cercare visite community che includono uno specifico museo.

### Default delle visite ufficiali

Una visita ufficiale contiene una policy globale:

```json
{
  "defaultPresentationPolicy": {
    "durationKey": "medium",
    "languageLevelKey": "simple"
  }
}
```

La coppia viene validata contro il vocabolario del museo proprietario e deve essere supportata da ogni item della visita.

Il visitatore puo usare la policy `default` oppure una coppia custom appartenente allo stesso vocabolario del museo.

### Default delle visite community

Una visita community non puo contenere una policy globale, perche le chiavi dei musei coinvolti non sono confrontabili.

Ogni tappa parte dalla representation `isDefault` dell'item. Per pubblicare un item e obbligatorio avere esattamente una representation di default.

Le preferenze custom cross-museum non sono ancora implementate. Il backend non associa automaticamente etichette come `semplice` e `facile`.

La proposta di adattamento e documentata in `docs/community-vocabulary-strategy.md`.

### Workflow editoriale

Le visite community vengono pubblicate direttamente dal proprio autore, senza moderazione intermedia.

Le visite ufficiali possono essere create da operator e manager. In attesa di una decisione sui poteri editoriali dell'operator, modifica, controllo e pubblicazione delle visite ufficiali richiedono un manager.

Endpoint disponibili:

- `GET /api/visits`: visite pubblicate;
- `GET /api/visits/mine`: visite gestibili o visibili nel proprio ruolo;
- `POST /api/visits`: creazione in draft;
- `GET /api/visits/:visitId`;
- `PUT/PATCH /api/visits/:visitId`;
- `POST /api/visits/:visitId/check-consistency`;
- `POST /api/visits/:visitId/publish`.

Una modifica riporta sempre la visita in draft. Se un item usato dalla visita viene modificato, eliminato o reso incoerente da una modifica del vocabolario, la visita torna in draft e viene marcata `needs_review`.

## Item e permessi applicati

- creazione item: operator o manager del museo;
- modifica item: manager;
- controllo di consistenza: manager;
- pubblicazione: manager;
- cancellazione: manager.

Questa e una policy conservativa. L'utente ha specificato esplicitamente la creazione da parte dell'operator, ma non il resto del ciclo editoriale.

## Language level e duration

Ogni museo possiede vocabolari indipendenti. Sia `languageLevels` sia `durationTypes` sono ordinati localmente:

```json
{
  "key": "simple",
  "label": "Semplice",
  "level": 1,
  "description": "Lessico comune e frasi brevi"
}
```

Per ciascun vocabolario devono essere univoci:

- `key`;
- `level`.

Il campo `level` ordina soltanto le voci dello stesso museo. Non implica che il livello 2 del museo A sia semanticamente equivalente al livello 2 del museo B.

Il Navigator puo usare l'ordinamento locale per:

- durata superiore o inferiore mantenendo il language level locale;
- language level superiore o inferiore mantenendo la durata locale.

Le representation usano:

```json
{
  "durationKey": "medium",
  "languageLevelKey": "simple",
  "text": "...",
  "isDefault": true
}
```

Dato che il database e vuoto, non esiste uno strato di compatibilita con i vecchi schemi.

## Refactoring del codice precedente

Sono state applicate queste modifiche:

- `Item.createdBy` e `updatedBy` sono riferimenti a User;
- le mutazioni richiedono identita autenticata;
- la root di test non contiene testo interno;
- Express espone staticamente soltanto `public/`;
- gli errori Mongoose e i duplicati hanno risposte API coerenti;
- la prima representation non viene resa implicitamente default in base all'ordine dell'array;
- le modifiche degli item invalidano le visite dipendenti;
- `Museum.createdBy` identifica il creatore;
- la creazione del museo assegna automaticamente il ruolo manager;
- e disponibile `npm run seed:users` per creare gli account obbligatori.

## Decisioni ancora richieste

### Poteri editoriali dell'operator

Occorre decidere se un operator possa anche:

- modificare item e visite ufficiali;
- eseguire il controllo di consistenza;
- pubblicare;
- eliminare.

Attualmente queste azioni sono manager-only.

### Rimozione delle membership

E possibile assegnare o cambiare un ruolo, ma non rimuovere completamente un utente dal museo. Va definito se il manager possa revocare una membership e con quali garanzie.

### Ricerca degli utenti

L'endpoint di assegnazione usa `userId`. Va deciso se un manager possa cercare utenti per username, e quali dati possano essere restituiti senza esporre informazioni non necessarie.

### Visibilita dei draft

Le regole non specificano se item e visite in draft debbano essere visibili soltanto ai membri del museo o anche tramite le route pubbliche. La policy va definita prima del frontend editor.

### Preferenze community

Occorre scegliere:

- dove memorizzare la preferenza del compratore;
- come tradurre una preferenza astratta nei vocabolari locali;
- quale fallback usare quando la coppia desiderata non esiste;
- se il creatore community possa impostare un override per ogni tappa.

### Visibilita, ritiro e cancellazione delle visite

Non sono ancora stati introdotti `private`, `unlisted`, `archived`, unpublish o cancellazione delle visite pubblicate.

### Logistica

Le indicazioni indoor e i trasferimenti tra musei restano separate dagli item. La struttura definitiva verra affrontata nel prossimo dominio.
