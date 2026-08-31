
# Insegnamento di Tecnologie Web

# CdS in Informatica

# (A.A. 2025-26)

# Progetto ArtAround

# READ ME DEL PROGETTO ARTAROUND

Una copia IDENTICA di questo file deve trovarsi nella directory del progetto.

## Nome del gruppo

[DA COMPILARE]

## Membri del gruppo

* Nome e cognome: `Milo Disalvatore`, matricola: `0001160361`, mail: `milo.disalvatore@studio.unibo.it`
* Nome e cognome: `Simone Berti`, matricola: `0001161251`, mail: `simone.berti3@studio.unibo.it`
* LLM: OpenAI ChatGPT, modello/i utilizzato/i `5.6 Sol`, servizio proprietario soggetto ai termini OpenAI.

Il primo membro della lista viene considerato punto di contatto primario. È la persona incaricata di spedire le mail, sempre e solo dall'indirizzo studio.unibo.it, e di tenere i contatti con i docenti.

Ogni mail deve includere tutti i componenti del gruppo in cc e deve essere indirizzata a tutti i docenti del corso:

* [fabio.vitali@unibo.it](mailto:fabio.vitali@unibo.it)
* [andrea.schimmenti2@unibo.it](mailto:andrea.schimmenti2@unibo.it)
* [gianmarco.spinaci2@unibo.it](mailto:gianmarco.spinaci2@unibo.it)
* [remo.grillo@unibo.it](mailto:remo.grillo@unibo.it)

## Tipo progetto

18-27

## Data di disponibilità delle applicazioni

15 Settembre

La data indicata deve essere al massimo 15 giorni successiva alla data di sottomissione del presente README.

## Locazione del progetto

* URI del marketplace: `https://[HOST-DIPARTIMENTO]/marketplace/` ///////////////////777
* URI del navigator: `https://[HOST-DIPARTIMENTO]/navigator/`


## Organizzazione dei sorgenti 

```text
/home/web/site252605/html/
├── README.txt
└── sources/
    ├── index.js
    ├── app.js
    ├── package.json
    ├── package-lock.json
    ├── config/
    ├── controllers/
    ├── middlewares/
    ├── models/
    ├── routes/
    ├── services/
    ├── scripts/
    ├── uploads/
    ├── clients/
    │   ├── marketplace/
    │   │   ├── src/
    │   │   ├── package.json
    │   │   └── dist/
    │   └── navigator/
    │       ├── src/
    │       ├── package.json
    │       └── dist/
    └── ...
```
## Tecnologie utilizzate

### Server-side

Linguaggio:

* JavaScript, eseguito tramite Node.js.

Database:

* MongoDB.

ODM:

* Mongoose `^7.8.11`.

Framework e pacchetti NPM installati dal progetto:

* Express `^4.22.2` — server HTTP e routing REST;
* Mongoose `^7.8.11` — accesso e modellazione dei dati MongoDB;
* Socket.IO `^4.8.3` — comunicazione realtime, utilizzata in particolare dal sistema di visite sincronizzate;
* CORS `^2.8.5` — gestione delle politiche Cross-Origin Resource Sharing;
* dotenv `^17.3.1` — caricamento della configurazione da variabili d'ambiente;
* nodemon `^3.1.14` — dipendenza di sviluppo per il riavvio automatico del server.


### Applicazione marketplace

Linguaggi:

* JavaScript ES Modules;
* HTML;
* CSS.

### Applicazione navigator

Linguaggi:

* TypeScript;
* JavaScript;
* HTML;
* CSS.

Framework e librerie runtime:

* Vue `3.5.41` — framework dell'interfaccia;
* Vue Router `5.2.0` — routing client-side;
* Pinia `4.0.3` — gestione dello stato;
* Socket.IO Client `^4.8.3` — comunicazione realtime con il server.

Strumenti e dipendenze di sviluppo:

* Vite `8.2.2` — development server e build;
* TypeScript `6.0.2`;
* `@vitejs/plugin-vue` `6.0.8`;
* `vue-tsc` `3.3.11` — controllo statico dei componenti Vue e del codice TypeScript.

## Contributo individuale

### [PERSONA 1 — Milo Disalvatore]

Ha lavorato principalmente sul Navigator, sui flussi di preparazione ed esecuzione delle visite e sulla progettazione delle visite sincronizzate. Ha inoltre contribuito all'integrazione frontend/backend, alla progettazione e sviluppo degli editor dei contenuti e dei vocabolari, pagina login e register e home.

### [PERSONA 2 — Simone Berti]

Ha lavorato principalmente sul Marketplace e sull'Editor, sulla progettazione del modello di dominio semantico e fisico e sui workflow di creazione e organizzazione dei contenuti. Ha inoltre contribuito alla progettazione delle venue, dei vocabolari, delle relazioni tra item e alla definizione dell'architettura generale del sistema.

### LLM

Durante lo sviluppo è stato utilizzato un Large Language Model come strumento di supporto.

Il contributo dell'LLM ha incluso attività quali:

* supporto all'analisi e alla progettazione dell'architettura;
* discussione e revisione del modello di dominio;
* proposta e revisione di implementazioni frontend e backend;
* supporto al refactoring;
* individuazione e analisi di bug;
* supporto alla scrittura e revisione dei test;
* supporto alla preparazione di seed e dati dimostrativi;
* revisione della coerenza tra implementazione e specifiche;
* supporto alla documentazione tecnica.
