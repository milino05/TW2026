# Logistica adattiva e learning engine

## Obiettivo

La logistica di ArtAround e un dominio separato dagli Item. Il museo descrive la realta fisica e i vincoli dichiarativi; la visita compone tappe e percorsi preferiti; il Navigator adatta routing e durata all'utente.

Il sistema distingue sempre:

1. **fatti editoriali del museo**: layout, distanze, accessibilita dichiarata, PlaceType, connection e istruzioni;
2. **preferenze esplicite dell'utente**: ritmo e routing requirements;
3. **profili appresi**: stime comportamentali con confidence;
4. **osservazioni della sessione corrente**.

I dati appresi non modificano mai automaticamente i fatti del layout. Un requisito `required` non puo essere violato perche altri utenti hanno seguito un percorso incompatibile.

## Layout revisionato

```text
Museum
└── MuseumLayout
    ├── publishedRevisionId
    └── workingRevisionId
        └── MuseumLayoutRevision
            ├── placeTypes
            ├── routingAttributes
            ├── routingPresets
            ├── floors
            ├── places
            ├── itemPlacements
            ├── connections
            └── preVisitInformation
```

L'operator modifica il working layout e richiede revisione; il manager pubblica.

### PlaceType

I tipi di luogo sono configurabili dal museo. Gli eventuali `userIntents` appartengono invece al catalogo globale controllato (`FIND_EXIT`, `FIND_TOILET`, ecc.), cosi il Navigator puo tradurre uno stesso comando verso vocabolari museali diversi.

### RoutingAttribute

Ogni museo puo creare attributi locali e, opzionalmente, mapparli a un `canonicalKey` globale. Esempio:

```json
{
  "key": "senza_gradini",
  "canonicalKey": "step_free",
  "dataType": "boolean",
  "appliesTo": "connection"
}
```

Le preferenze globali dell'utente possono cosi attraversare musei differenti senza imporre le stesse chiavi locali.

## Routing

I requirements hanno priorita:

- `required`: hard constraint, l'arco incompatibile viene escluso;
- `preferred`: preferenza soft.

Per le preferenze soft non viene usata una penalita assoluta in secondi. Il router confronta il percorso piu veloce compatibile con un percorso che soddisfa meglio le preferenze e accetta il detour soltanto entro la tolleranza relativa definita da `AdaptivePolicy`.

Una transizione della visita puo avere un `plannedPath`. Il Navigator lo usa se:

1. e topologicamente continuo;
2. collega davvero i due ItemPlacement;
3. e compatibile con i requirements correnti.

Altrimenti esegue routing dinamico sul layout pubblicato corrente.

## Timing

Il tempo e separato in componenti:

```text
T_visit = T_content + T_observation + T_logistics + T_visitResidual
```

- `T_content`: somma dei `targetSeconds` delle representation effettivamente selezionate;
- `T_observation`: tempo dedicato all'osservazione fisica degli oggetti;
- `T_logistics`: movimento, delay dichiarati e correzioni apprese degli archi;
- `T_visitResidual`: effetto specifico della visita non spiegato dagli altri modelli.

### Baseline statica

Ogni `VisitRevision` pubblicata conserva uno snapshot immutabile:

```text
baselineTiming
├── estimatedContentSeconds
├── estimatedObservationSeconds
├── estimatedLogisticsSeconds
├── estimatedTotalSeconds
├── adaptivePolicyVersion
└── computedAt
```

La baseline viene calcolata alla pubblicazione per un visitatore generico usando i dati disponibili in quel momento. Non viene riscritta successivamente da Item/layout/vocabulary changes: una nuova revisione della visita produce una nuova baseline.

### Pre-visita personalizzata

Prima dell'avvio il planner combina:

- representation effettive dell'utente;
- `UserAdaptiveProfile`;
- `GlobalAdaptiveProfile`;
- `MuseumAdaptiveProfile`;
- `ItemObservationProfile`;
- `ConnectionLearnedProfile` e routing-attribute prior;
- `VisitTimingProfile`.

Restituisce una stima personalizzata e, quando disponibile, una fascia temporale tipica della visita.

### Sessione live

`VisitSession` congela la stima iniziale e raccoglie osservazioni runtime. Il movimento personale viene stimato sottraendo dai tempi osservati delay fissi e correzioni gia attribuite all'arco, per non confondere una scala/attesa lenta con una persona che cammina lentamente.

Il `VisitTimingProfile` impara il residuo rispetto alla **base estimate priva del residuo della visita stessa**, evitando feedback loop auto-rinforzanti.

## Apprendimento cross-visita

L'adattamento della sessione corrente funziona indipendentemente dalla memoria persistente. La memoria e divisa in due preferenze:

```text
learningPreferences.personalHistory
learningPreferences.collectiveContribution
```

`null` significa che l'utente non ha ancora completato la scelta di onboarding.

- `personalHistory=true`: aggiorna `UserAdaptiveProfile` per le visite future;
- `collectiveContribution=true`: contribuisce ai modelli aggregati;
- entrambe false: le osservazioni raw completate vengono cancellate dopo la sessione.

## Contributor pseudonimi

I modelli collettivi non contano semplicemente le sessioni. Ogni utente contribuisce a uno scope tramite un identificatore:

```text
HMAC-SHA256(ADAPTIVE_CONTRIBUTOR_SECRET, userId)
```

Il secret deve restare stabile per tutta la vita del database.

`LearningContribution` mantiene un contributo sintetico per contributor + metrica + scope. I modelli collettivi vengono quindi aggregati tra contributor, riducendo il rischio che un power user domini la confidence.

## Profili appresi

```text
GlobalAdaptiveProfile
MuseumAdaptiveProfile
UserAdaptiveProfile
ItemObservationProfile
ConnectionLearnedProfile
RoutingAttributeLearnedProfile
VisitTimingProfile
```

Gerarchia tipica:

```text
sessione corrente
→ storico utente
→ profilo specifico item/arco/visita
→ profilo museo
→ profilo globale
→ cold-start fallback
```

La `confidence` impedisce a pochi campioni di sostituire prematuramente i fallback.

## AdaptivePolicy

`config/adaptivePolicy.js` non e un pannello da calibrare periodicamente. Contiene soltanto:

- versione dell'algoritmo;
- fallback di cold start;
- limiti di sicurezza;
- soglie di confidence/reliability;
- politica relativa del detour.

Velocita tipiche, observation time, pace factor e correzioni non vengono aggiornati da un programmatore: sono Learned Profiles persistiti in MongoDB.

## Cambio layout

Alla pubblicazione di una nuova `MuseumLayoutRevision` vengono controllate tutte le VisitRevision dipendenti.

- se placement e raggiungibilita restano validi: la visita pubblicata resta disponibile e riceve warning;
- se manca un placement o una coppia di tappe non e piu raggiungibile: viene creato un repair draft e la visita incompatibile viene rimossa dalla pubblicazione;
- la baseline della vecchia revisione pubblicata rimane uno snapshot storico immutabile;
- le revisioni di lavoro vengono invalidate e ricalcoleranno la baseline prima della nuova pubblicazione.

Il runtime ignora un `layoutRevisionId` superseded e usa il layout pubblicato corrente.

## Privacy e controllo utente

Le API supportano una scelta granulare fra memoria personale e contributo collettivo. Il frontend deve spiegare che disabilitando la memoria cross-visita l'adattamento continua nella sessione corrente ma non parte gia calibrato nelle visite successive.

`DELETE /api/users/me/adaptive-profile` rimuove il profilo personale, le osservazioni storiche conservate e i contributi pseudonimi associabili allo stesso contributor HMAC. Gli aggregati statistici gia derivati non contengono il contributorHash; vengono comunque corretti quando lo scope viene nuovamente aggregato.

## Variabile ambiente

```text
ADAPTIVE_CONTRIBUTOR_SECRET=<random-long-secret>
```

E obbligatoria quando viene abilitato il contributo collettivo.
