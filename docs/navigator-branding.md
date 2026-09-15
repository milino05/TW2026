# Configurare Navigator per un museo

Navigator separa il software dalle identità museali. Prima della selezione usa il branding neutrale ArtAround; quando l’utente sceglie un museo carica titoli, immagini e colori della Venue selezionata, senza ricompilare il client.

La pagina `/navigator/museums` deriva l’elenco dai musei per cui l’utente possiede almeno una visita eseguibile. Ogni configurazione museale resta associata a una singola Venue tramite `venueId`. Opere, tappe, visite, mappe logiche e azioni restano dati di dominio serviti dalle API e non vanno duplicati nel file di configurazione.

## Struttura della directory

Una distribuzione può contenere il branding di piattaforma e qualunque numero di musei:

```text
navigator-runtime/
├── navigator-platform/
│   ├── navigator.config.json
│   └── navigator-assets/
│       ├── artaround-mark.svg
│       └── artaround-hero.svg
└── navigator-configs/
    ├── <venueId-a>/
    │   └── navigator.config.json
    └── <venueId-b>/
        └── navigator.config.json
```

Gli asset della piattaforma restano file statici. Gli asset dei musei in schema v3 sono invece memorizzati in MongoDB e il JSON li identifica tramite `assetId` stabile. Più Venue della stessa organizzazione possono quindi condividere logo e hero senza duplicare i file.

## Schema piattaforma v1

Il file `navigator-platform/navigator.config.json` usa `schemaVersion: 1`, non contiene `venueId` e continua a usare `src` sotto `/navigator-assets/`. Viene usato per login e selezione museo.

## Schema museo v3

```json
{
  "schemaVersion": 3,
  "venueId": "496f78e51b8861a9800749a7",
  "branding": {
    "productTitle": "ArtAround",
    "museumTitle": "Pinacoteca Nazionale di Bologna",
    "subtitle": "Demo TW2026",
    "logo": {
      "assetId": "68c000000000000000000001",
      "alt": "Marchio della Pinacoteca"
    },
    "heroImage": {
      "assetId": "68c000000000000000000002",
      "alt": "Sala della Pinacoteca"
    },
    "theme": {
      "primary": "#84333E",
      "accent": "#BD8D50",
      "surface": "#F7F3EB"
    }
  }
}
```

Campi:

- `schemaVersion`: `3` per una configurazione museo corrente;
- `venueId`: ObjectId MongoDB della Venue a cui appartiene il file;
- `productTitle`: nome del prodotto;
- `museumTitle`: nome mostrato nel Navigator;
- `subtitle`: testo breve facoltativo;
- `logo` e `heroImage`: riferimenti facoltativi a `NavigatorAsset` MongoDB con testo alternativo;
- `theme`: colori esadecimali `#RRGGBB` per identità principale, accento e superficie.

Logo, immagine hero e palette vengono applicati a Library, generazione, shell dell’app e schermata immersiva di esecuzione. Login e selettore musei usano invece la configurazione neutrale di piattaforma.

## Modifica dal Marketplace

Nel workspace della Venue è disponibile la sezione **Navigator**. Un utente con `venue.profile.manage` può modificare titoli e colori, caricare logo/hero, copiare la configurazione da un’altra Venue della stessa organizzazione e importare/esportare il JSON.

Il file `navigator.config.json` resta la fonte di verità della personalizzazione. MongoDB conserva soltanto gli asset identificati dal file. Durante import o copia il `venueId` di destinazione non viene mai preso dal JSON sorgente: è sempre imposto dal backend in base alla Venue che si sta modificando.

Gli `assetId` sono riutilizzabili soltanto all’interno della stessa installazione e organizzazione. L’export JSON è quindi adatto a conservare e riapplicare una configurazione tra Venue dello stesso database; non è un backup autonomo dei byte delle immagini.

## Migrazione da v2

Lo schema v2 con `logo.src` e `heroImage.src` resta leggibile durante la transizione. Il primo salvataggio/copia importa gli asset legacy nel database e scrive il file in v3. Per migrare in modo esplicito tutte le configurazioni presenti nella directory configurata:

```bash
npm run migrate:navigator-config-v3
```

La migrazione usa ID deterministici per gli asset legacy, quindi può essere rieseguita senza creare duplicati per la stessa Venue/ruolo/contenuto.

## Verifica

Prima del deploy eseguire:

```bash
npm --prefix clients/navigator run check:config
```

Il controllo verifica la configurazione di piattaforma, le configurazioni museali incluse, schemi, colori e riferimenti asset. Per i config v2 controlla ancora anche sicurezza dei percorsi ed esistenza dei file legacy.

## Uso senza ricompilazione

Dopo aver costruito il client, impostare `NAVIGATOR_CONFIG_DIR` sulla directory radice che contiene `navigator-platform/` e `navigator-configs/`:

```dotenv
NAVIGATOR_CONFIG_DIR=/srv/artaround/navigator-runtime
```

Express serve la piattaforma su `/navigator-platform/...`, ogni museo su `/navigator-configs/:venueId/...` e l’app invariata su `/navigator/`. I JSON sono senza cache; gli asset Mongo vengono serviti su `/api/navigator-assets/:assetId` con cache immutabile.

Se nella directory esterna manca un file, il server cerca la configurazione inclusa nel repository/build. Se manca la configurazione di un museo posseduto, l’interfaccia mantiene il fallback neutrale con il nome della Venue.

Per permettere la modifica dal Marketplace la directory esterna deve essere scrivibile dal processo backend. In Docker Compose non montarla `:ro`:

```yaml
services:
  backend:
    volumes:
      - ./navigator-runtime:/app/runtime/navigator
    environment:
      NAVIGATOR_CONFIG_DIR: /app/runtime/navigator
```

Riavviare il processo Node soltanto quando cambia il percorso configurato. La modifica di un JSON dal Marketplace non richiede una nuova build: un refresh del Navigator ricarica la configurazione.
