# User, Visit e presentazione adattiva

Questo documento descrive il perimetro implementato nel branch `user-visit` e le decisioni ancora aperte.

## User e autenticazione

Il modello User contiene:

- `username` univoco e normalizzato;
- `passwordHash` scrypt, escluso dalle query ordinarie;
- `memberships` contestuali a un museo;
- ruolo iniziale `operator`;
- stato `active` o `disabled`.

L'autenticazione usa sessioni server-side in MongoDB e cookie HttpOnly. L'identita dell'attore deriva esclusivamente dalla sessione e non viene mai accettata dal body.

Endpoint disponibili:

- `POST /api/auth/register`;
- `POST /api/auth/login`;
- `POST /api/auth/logout`;
- `GET /api/auth/me`.

La registrazione crea un utente community senza membership. Le membership da operatore devono essere assegnate da un flusso amministrativo o seed controllato.

## Visit

Un'unica collezione gestisce:

- visite `official`, con `ownerMuseumId` obbligatorio;
- visite `community`, senza `ownerMuseumId` e potenzialmente multi-museo.

Le tappe sono ordinate esclusivamente dalla posizione nell'array `stops`. Non esiste un secondo campo `order`.

Ogni tappa contiene l'item principale. Le rappresentazioni alternative e gli approfondimenti su autore, stile, periodo e altri argomenti restano nel modello Item e nel grafo delle relazioni; non diventano tappe della visita.

`museumIds` e derivato dagli item delle tappe e consente di cercare visite community che includono uno specifico museo.

### Policy predefinita

Il creatore deve specificare:

```json
{
  "defaultPresentationPolicy": {
    "durationKey": "medium",
    "languageLevelKey": "simple"
  }
}
```

La visita puo essere pubblicata soltanto se ogni item possiede una representation con quella coppia. L'opzione utente `default` riutilizza questa policy; una preferenza `custom` deve specificare entrambe le chiavi.

### Workflow

Le visite community vengono pubblicate direttamente dal proprio autore, senza moderazione intermedia. Le visite ufficiali vengono pubblicate da un operatore del museo proprietario.

Endpoint disponibili:

- `GET /api/visits`: visite pubblicate;
- `GET /api/visits/mine`: visite gestibili dall'utente;
- `POST /api/visits`: creazione in draft;
- `GET /api/visits/:visitId`;
- `PUT/PATCH /api/visits/:visitId`;
- `POST /api/visits/:visitId/check-consistency`;
- `POST /api/visits/:visitId/publish`.

Una modifica riporta sempre la visita in draft. La pubblicazione verifica autore, museo, item, integrita e disponibilita della policy predefinita.

Se un item usato dalla visita viene modificato, eliminato o reso incoerente da una modifica del vocabolario, la visita torna in draft e viene marcata `needs_review`.

## Language level e duration

Sia `languageLevels` sia `durationTypes` sono vocabolari ordinati:

```json
{
  "key": "simple",
  "label": "Semplice",
  "level": 1,
  "description": "Lessico comune e frasi brevi"
}
```

Per entrambi devono essere univoci:

- `key`;
- `level`.

I livelli non devono essere consecutivi. Il Navigator usa l'ordinamento numerico per selezionare la prima representation effettivamente disponibile:

- durata superiore/inferiore mantenendo il language level;
- language level superiore/inferiore mantenendo la durata.

Le representation usano campi coerenti:

```json
{
  "durationKey": "medium",
  "languageLevelKey": "simple",
  "text": "..."
}
```

Dato che il database e vuoto, non esiste uno strato di compatibilita con il precedente campo `languageLevel` o con array di stringhe.

## Refactoring del codice precedente

Sono state applicate queste modifiche:

- `Item.createdBy` e `updatedBy` sono riferimenti a User;
- le mutazioni di musei e item richiedono autenticazione;
- la root di test non contiene piu testo interno;
- Express espone staticamente soltanto `public/`, non l'intera repository;
- gli errori Mongoose e i duplicati hanno risposte API coerenti;
- la prima representation non viene piu resa implicitamente default in base all'ordine dell'array;
- le modifiche degli item invalidano le visite dipendenti;
- e disponibile `npm run seed:users` per creare gli account obbligatori con password `12345678`.

## Punti ancora aperti

### Persistenza delle preferenze dopo l'acquisto

E definita la semantica `default/custom`, ma non dove salvare la preferenza del singolo acquirente. La scelta dipende dal futuro modello marketplace:

1. documento `VisitPurchase` che contiene anche le preferenze;
2. documento separato `UserVisitPreference` collegato a un diritto di accesso;
3. preferenze nel profilo utente.

La seconda soluzione separa meglio acquisto e configurazione, ma richiede un controllo esplicito del diritto di accesso.

### Permessi fini su item e musei

Le mutazioni richiedono login, ma non e ancora definito se un item possa essere modificato:

- soltanto dal suo autore;
- dall'autore e dagli operatori del museo;
- da qualunque autore che abbia adottato il contenuto.

Non e neppure definito chi possa creare un museo o assegnare membership da operatore.

### Visibilita, ritiro e cancellazione

Non sono stati introdotti `private`, `unlisted`, `archived`, unpublish o cancellazione delle visite pubblicate.

### Logistica

Le indicazioni indoor e i trasferimenti tra musei restano separati dagli item. La struttura definitiva verra affrontata nel prossimo dominio.
