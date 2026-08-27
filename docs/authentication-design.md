# Scelta dell'autenticazione

## Alternative considerate

### HTTP Basic Authentication

Il client invia username e password a ogni richiesta.

Vantaggi:

- implementazione molto semplice;
- nessuna gestione separata di token o sessioni.

Svantaggi:

- le credenziali vengono riutilizzate continuamente;
- logout e revoca sono poco naturali;
- esperienza browser scadente;
- inadatto a marketplace e Navigator come applicazioni interattive.

Decisione: scartata.

### JWT stateless

Il server emette un token firmato che il client invia nelle richieste successive.

Vantaggi:

- non richiede una sessione nel database;
- adatto a sistemi distribuiti con molti servizi;
- semplice da usare come Bearer token per client non browser.

Svantaggi:

- revocare immediatamente un token richiede blacklist o token di breve durata con refresh token;
- conservare il token in localStorage lo espone a furti in caso di XSS;
- usare JWT in cookie riporta comunque al problema CSRF;
- aggiunge complessita non necessaria per un solo backend Node e Mongo.

Decisione: scartata per questo progetto.

### Sessione server-side con cookie HttpOnly

Il browser conserva un token casuale in un cookie non leggibile da JavaScript. MongoDB conserva soltanto l'hash del token e l'associazione con l'utente.

Vantaggi:

- logout e revoca immediati;
- nessun token accessibile al JavaScript del frontend;
- sessioni controllabili e disabilitabili dal server;
- soluzione adatta a marketplace e Navigator web collegati allo stesso backend;
- nessuna dipendenza da un'infrastruttura esterna.

Svantaggi:

- ogni richiesta autenticata richiede una lettura della sessione;
- il database deve contenere e ripulire le sessioni;
- i cookie richiedono protezione CSRF e configurazione CORS corretta.

Decisione: scelta.

### Provider esterno OAuth/OIDC

Autenticazione delegata a Google, Microsoft o altro identity provider.

Vantaggi:

- gestione professionale delle credenziali;
- possibile supporto a MFA e recupero account.

Svantaggi:

- dipendenza da Internet e da servizi esterni;
- configurazione e callback piu complesse;
- inadatto alle condizioni di laboratorio e rete parzialmente isolata del corso.

Decisione: scartata.

## Implementazione scelta

- password derivate con `crypto.scrypt` e salt casuale;
- token di sessione casuale da 32 byte;
- nel database viene salvato solo SHA-256 del token;
- cookie `HttpOnly`, `SameSite=Lax`, `Secure` in produzione;
- sessioni con scadenza e indice TTL MongoDB;
- controllo dell'Origin sulle richieste mutative;
- identita ricavata esclusivamente dalla sessione, mai dal body;
- registrazione libera crea utenti senza membership Organization;
- ruoli, membership e autorità Owner non possono essere autoassegnati tramite registrazione.

## Configurazione

- `SESSION_DURATION_HOURS`: durata della sessione, default 168 ore;
- `SESSION_COOKIE_SECURE=true`: forza cookie Secure;
- `NODE_ENV=production`: abilita automaticamente cookie Secure;
- `CORS_ORIGINS`: lista separata da virgole delle origini frontend autorizzate in sviluppo o deploy separato.
