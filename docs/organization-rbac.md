# Organization Custom RBAC

Questo documento descrive il modello autorizzativo Organization corrente di ArtAround. Sostituisce ogni riferimento operativo ai ruoli fissi `manager` e `operator` nei documenti precedenti.

## Modello

Le responsabilità sono separate in tre entità:

- `OrganizationMembership`: lega un utente attivo a una Organization e contiene una o più assegnazioni di ruolo;
- `OrganizationRole`: ruolo locale alla singola Organization, con nome univoco normalizzato e un insieme allow-only di permission code della piattaforma;
- `Organization.owners`: autorità radice separata dai permessi ordinari, con `userId`, `grantedBy` e `grantedAt`.

I permessi effettivi sono l'unione live dei ruoli assegnati. Non esistono ruolo attivo, deny, precedenze, gerarchie o wildcard. Le dipendenze dichiarate dal registry vengono chiuse automaticamente; per esempio `item.edit` include `item.view`.

Una membership attiva deve contenere almeno un ruolo e non può contenere lo stesso ruolo due volte. I ruoli assegnati non possono essere eliminati. La modifica di un ruolo ha effetto immediato su tutte le membership che lo usano.

## Owner

Ogni Organization ha almeno un Owner, che deve anche essere un membro attivo. Il creatore riceve atomicamente autorità Owner e ruolo `Administrator`. Owner non concede implicitamente permessi editoriali, fisici, commerciali o amministrativi ordinari: questi derivano sempre dai ruoli.

Solo un Owner può nominare o revocare altri Owner. L'ultimo Owner non può essere revocato e una membership Owner non può essere rimossa prima della revoca dell'autorità radice. L'Owner non è una scorciatoia per la UI e viene mostrato con un badge separato dai nomi dei ruoli.

## Delegation ceiling

Un membro non-Owner può creare/modificare ruoli o assegnarli soltanto se possiede i permessi di governance richiesti e tutti i permessi effettivi che sta delegando. La verifica usa la dependency closure. Un Owner che possiede i permessi ordinari di gestione ruoli non è soggetto al ceiling, ma l'autorità Owner da sola non abilita tali operazioni.

## Registry e ruoli iniziali

I permission code sono definiti centralmente e raggruppati per governance, spazio editoriale, contenuti, Namespace, contesti editoriali, visite, sedi e Marketplace. Alla creazione vengono materializzati sei ruoli locali:

1. `Administrator`
2. `Curator`
3. `Contributor`
4. `Venue Manager`
5. `Marketplace Manager`
6. `Viewer`

Le loro matrici sono bootstrap modificabili dell'Organization, non ruoli globali hard-coded nei boundary applicativi.

## Transazioni e audit

MongoDB viene avviato come replica set anche in sviluppo e CI. Creazione Organization, mutazioni di ruolo, assegnazioni membership e variazioni Owner vengono eseguite in transazione insieme al relativo `OrganizationAuthorizationEvent`.

Il registro autorizzativo è append-only e contiene gli eventi di creazione Organization, membership, ruoli e Owner. È visibile soltanto con `organization.audit.view`. Gli endpoint pubblici Organization espongono esclusivamente i dati di profilo.

## Projection e UI

Il backend autorizza ogni command e proietta `availableSections[]`, `availableOperations[]` e capability user-facing. Il Marketplace non deduce permessi dai nomi dei ruoli.

La console Organization espone soltanto le sezioni disponibili tra Panoramica, Persone, Ruoli, Sedi, Regole editoriali e Impostazioni. La gestione Persone supporta assegnazioni multi-ruolo e Owner; il role builder mostra gruppi, dipendenze e permessi ad alto impatto. Create Hub, Libreria e Vendite omettono azioni e dati non autorizzati. In particolare i dati finanziari richiedono `marketplace.finance.view`, separato dalla sola consultazione della distribuzione.

## Migrazione legacy

`npm run migrate:organization-rbac` migra una sola volta le membership embedded storiche:

- creatore Organization e legacy `manager` → `Administrator`;
- legacy `operator` → `Contributor`;
- creatore → Owner con provenance iniziale.

La migrazione richiede `MONGO_URI` verso un replica set e rimuove `users.organizationMemberships` solo dopo avere completato le transazioni per tutte le Organization.
