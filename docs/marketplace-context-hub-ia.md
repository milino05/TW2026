# Marketplace/Editor — Context Hub e IA contestuale

Questa decisione **sostituisce le parti incompatibili** della sezione `Marketplace/Editor UX — IA novice-first e progressive disclosure` in `client-architecture-decisions.md`. Tutti gli altri principi di dominio e i Punti 1–30 restano invariati.

## Decisione

Dopo il login il Marketplace non apre direttamente Catalogo/Workspace e non ripete selector `principal` nelle singole view. Apre invece un **Context Hub** in cui l'utente sceglie l'area operativa per la sessione:

- **Area personale** (`User`);
- una delle **Organization** per cui il backend espone accesso;
- eventuale creazione di una nuova Organization quando `organization.create` è disponibile.

Il contesto operativo è una preferenza applicativa di sessione, non una nuova entità di dominio. Viene memorizzato client-side in `sessionStorage`, rivalidato contro la projection `account-workspace` e cancellato al logout/login. Il backend continua a ricevere il principal esplicito nei boundary in cui serve e resta l'unica autorità per authorization, capability, ownership e workflow.

Il contesto operativo **non è**:

- autenticazione o actor identity;
- Entitlement o beneficiary commerciale;
- ownership implicita di una risorsa esistente;
- Organization derivata dalla Venue;
- museo/Venue selezionato;
- `selectedVenueIds[]` del Catalogo;
- EditorialContext, ContentSpace o Namespace implicito.

Per una risorsa esistente, un deep link che appartiene a un altro owner non cambia silenziosamente il contesto scelto: la mismatch viene rifiutata o ricondotta a un flusso esplicito.

## Navigazione principale

Con un contesto operativo attivo, la navigazione user-facing è:

**Home · Esplora · Libreria · Crea · Marketplace · Account**

- **Home**: dashboard contestuale personale o Organization.
- **Esplora**: discovery globale, con sottosezioni **Catalogo · Organizzazioni · Sedi**. La discovery non modifica il contesto operativo.
- **Libreria**: risorse owned e licensed utilizzabili dal contesto corrente.
- **Crea**: nuovi contenuti e Visit, automaticamente owned dal contesto selezionato e mostrati soltanto quando le relative capability sono disponibili; nessun selector locale di principal.
- **Marketplace**: acquisizioni/licenze del beneficiary corrente e vendite del seller corrente, senza selector duplicati.
- **Account**: preferenze personali, Organization accessibili e strumenti editoriali personali. La creazione Organization è centralizzata nel Context Hub.

La voce **Crea** è attiva per i flussi di creazione; un editor aperto su una risorsa esistente appartiene semanticamente alla **Libreria**.

## Organization e Venue

La Home operativa di una Organization, la console privata di gestione e il profilo pubblico sono responsabilità diverse:

- **Home Organization**: lavoro quotidiano nel contesto scelto;
- **Gestione Organization**: panoramica, persone, ruoli, sedi, regole e impostazioni, tramite projection management, `availableSections[]` e `availableOperations[]` backend-authoritative;
- **Profilo Organization pubblico**: descrizione, Venue pubbliche e pubblicazioni Marketplace dell'Organization, senza funzioni amministrative.

Analogamente, la pagina pubblica di una Venue espone solo lo stato pubblicato e collega al Catalogo filtrato per rilevanza fisica. I contenuti editoriali non diventano proprietà della Venue e possono essere pubblicati da altri User/Organization.

## Vincoli preservati

- Ownership/authority, editorial scope e physical scope restano separati.
- `selectedVenueIds[]` resta un filtro fisico transitorio e modificabile.
- Beneficiary/seller/owner restano concetti distinti nel backend anche quando la UI li deriva dal contesto operativo.
- `availableOperations[]` resta autorevole; il client non deduce permessi dal contesto.
- i nomi dei ruoli Organization non sono contratti applicativi: i permessi effettivi sono l'unione live dei ruoli locali e Owner resta un'autorità separata;
- Navigator → Marketplace può inizializzare la selezione Venue del Catalogo senza determinare l'Organization operativa.
- La soluzione resta compatibile con 18–27/18–33: teacher/session authority, geolocation/QR e capability future possono usare gli stessi boundary senza trasformare il Context Hub in authorization o physical state.

## Guardrail di test

I contract client devono verificare il Context Hub, la persistenza di sessione e l'assenza dei vecchi selector locali (`data-principal-form`, `data-new-principal`, `data-commerce-principal`). Non devono invece richiedere query `principalType/principalId` nella navigazione o specifiche microcopy non normative.
