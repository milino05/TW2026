# User, musei e visite

## Utenti e ruoli contestuali

Ogni utente attivo puo acquistare visite, creare visite community e creare un museo.

La creazione di un museo assegna automaticamente al creatore una membership `manager`. Il creatore e registrato in `Museum.createdBy`, campo immutabile.

Le membership sono contestuali:

```json
{
  "museumId": "...",
  "role": "operator | manager",
  "assignedBy": "...",
  "assignedAt": "..."
}
```

Gerarchia:

- `operator`: crea e modifica tutti gli item e le visite ufficiali del museo, controlla la consistenza, richiede la pubblicazione e usa il cestino;
- `manager`: eredita i privilegi operator, pubblica, modifica il vocabolario, ripristina, esegue hard delete e gestisce i membri;
- creatore: e l'unico manager che puo retrocedere un altro manager a operator e non puo essere rimosso o retrocesso.

Qualunque manager puo aggiungere o rimuovere operator e promuovere un operator a manager. Un manager ordinario non puo retrocedere un manager.

L'assegnazione applicativa puo usare uno username esatto:

```text
POST /api/museums/:museumId/members
```

```json
{
  "username": "autore2",
  "role": "operator"
}
```

Non viene esposto un elenco pubblico degli utenti.

## Visite ufficiali e community

Una sola entita stabile `Visit` rappresenta entrambi i casi:

```text
kind: official | community
```

Visita ufficiale:

- possiede `ownerMuseumId`;
- contiene soltanto item di quel museo;
- usa una `defaultPresentationPolicy` locale;
- usa il workflow operator-manager.

Visita community:

- non possiede `ownerMuseumId`;
- puo contenere item di musei differenti;
- viene pubblicata direttamente dal proprio autore;
- usa default locali e preferenze astratte cross-museum.

L'ordine dell'array `stops` e l'unica fonte dell'ordine delle tappe.

## Visibilita

- pubblico: revisioni pubblicate di item e visite;
- operator e manager: revisioni di lavoro del proprio museo;
- autore community: proprie revisioni di lavoro;
- nessun altro utente vede le bozze.

## Preferenze

Default globale community:

```text
PUT /api/users/me/presentation-preference
```

Override per visita e lettura della preferenza corrente:

```text
GET /api/visits/:visitId/preference
PUT /api/visits/:visitId/preference
```

Opzioni selezionabili per quella visita:

```text
GET /api/visits/:visitId/preference-options
```

Piano risolto per l'esecuzione:

```text
GET /api/visits/:visitId/presentation-plan
```

Il piano restituisce la revisione pubblicata selezionata per ogni item, la representation scelta e `estimatedContentSeconds`.

Il controllo del diritto di acquisto non e ancora implementato: verra collegato al futuro modello marketplace/entitlement. Le preferenze sono gia separate dal futuro documento commerciale, perche hanno un ciclo di vita indipendente dall'acquisto.
