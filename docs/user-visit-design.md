# User, musei e visite

## Utenti e ruoli contestuali

Ogni utente attivo puo acquistare visite, creare visite community e creare un museo. La creazione di un museo assegna automaticamente al creatore una membership `manager`; `Museum.createdBy` rimane immutabile.

Le membership sono contestuali:

```json
{
  "museumId": "...",
  "role": "operator | manager",
  "assignedBy": "...",
  "assignedAt": "..."
}
```

- `operator`: modifica Item, visite ufficiali e layout, controlla la consistenza, richiede revisione e usa il cestino;
- `manager`: eredita i privilegi operator, pubblica, modifica vocabolari, ripristina, esegue hard delete e gestisce i membri;
- creatore: unico manager che puo retrocedere un altro manager e non puo essere rimosso o retrocesso.

L'assegnazione puo usare uno username esatto con `POST /api/museums/:museumId/members`; non viene esposto un elenco pubblico degli utenti.

## Visite ufficiali e community

Una sola entita stabile `Visit` rappresenta entrambi i casi (`official | community`).

Una visita ufficiale possiede `ownerMuseumId`, usa soltanto item del museo, possiede una presentation policy locale e segue workflow operator-manager.

Una visita community non possiede `ownerMuseumId`, puo attraversare musei differenti, viene pubblicata direttamente dal proprio autore e usa preferenze astratte cross-museum.

L'ordine di `stops` e l'unica fonte dell'ordine delle tappe.

## Preferenze di presentazione

Default globale community:

```text
PUT /api/users/me/presentation-preference
```

Override per visita:

```text
GET /api/visits/:visitId/preference
PUT /api/visits/:visitId/preference
GET /api/visits/:visitId/preference-options
```

Piano risolto:

```text
GET /api/visits/:visitId/presentation-plan
```

Il piano restituisce la representation pubblicata effettivamente scelta per ogni tappa e `estimatedContentSeconds`.

## Preferenze di navigazione

Default utente:

```text
PUT /api/users/me/navigation-preference
```

Override della visita:

```text
PUT /api/visits/:visitId/navigation-preference
```

La preferenza comprende ritmo `0..1` relativo al comportamento tipico personale/popolazione e routing requirements `required | preferred`.

## Learning preferences

L'adattamento della sessione corrente e separato dalla persistenza cross-visita. L'onboarding imposta:

```json
{
  "personalHistory": true,
  "collectiveContribution": true
}
```

tramite:

```text
PUT /api/users/me/adaptive-learning
```

`personalHistory` controlla il profilo storico individuale; `collectiveContribution` controlla i contributi pseudonimi ai modelli globali/museali/item/arco/visita. Se entrambi sono false, la sessione puo comunque adattarsi live ma i raw observations completati non vengono mantenuti per il learning.

Profilo e reset:

```text
GET    /api/users/me/adaptive-profile
DELETE /api/users/me/adaptive-profile
```

## Timing

La `VisitRevision` pubblicata espone `baselineTiming`, snapshot statico calcolato alla pubblicazione. Il piano personalizzato runtime restituisce invece:

```text
estimatedContentSeconds
estimatedObservationSeconds
estimatedLogisticsSeconds
estimatedBaseTotalSeconds
estimatedVisitResidualSeconds
estimatedTotalSeconds
```

La stima pre-visita usa storico personale e learned profiles; durante `VisitSession` viene ulteriormente corretta dalle osservazioni reali.

## Visibilita

- pubblico: revisioni pubblicate di Item, visite e layout;
- operator/manager: revisioni di lavoro del proprio museo;
- autore community: proprie revisioni di lavoro;
- nessun altro utente vede le bozze.

Il controllo del diritto di acquisto non e ancora implementato: verra collegato al futuro modello marketplace/entitlement, separato dalle preferenze e dai profili adattivi.
