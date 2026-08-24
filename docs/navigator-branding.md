# Configurare Navigator per un museo

Navigator separa il software dalle identità museali. Prima della selezione usa il branding neutrale ArtAround; quando l’utente sceglie un museo carica titoli, immagini e colori della Venue selezionata, senza ricompilare il client.

La pagina `/navigator/museums` deriva l’elenco dai musei per cui l’utente possiede almeno una visita eseguibile. Ogni configurazione museale è associata a una Venue tramite `venueId`. Opere, tappe, visite, mappe logiche e azioni restano dati di dominio serviti dalle API e non vanno duplicati nei file statici.

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
    │   ├── navigator.config.json
    │   └── navigator-assets/
    │       ├── museum-mark.svg
    │       └── museum-hero.webp
    └── <venueId-b>/
        └── ...
```

I nomi degli asset sono liberi. Nel JSON i riferimenti iniziano sempre con `/navigator-assets/`: il client li risolve automaticamente rispetto alla cartella piattaforma o alla cartella del museo.

## Schema piattaforma v1

Il file `navigator-platform/navigator.config.json` usa `schemaVersion: 1` e lo stesso oggetto `branding` mostrato sotto, ma non contiene `venueId`. Viene usato per login e selezione museo.

## Schema v2

```json
{
  "schemaVersion": 2,
  "venueId": "496f78e51b8861a9800749a7",
  "branding": {
    "productTitle": "ArtAround",
    "museumTitle": "Pinacoteca Nazionale di Bologna",
    "subtitle": "Demo TW2026",
    "logo": {
      "src": "/navigator-assets/pinacoteca-mark.svg",
      "alt": "Marchio dimostrativo della Pinacoteca"
    },
    "heroImage": {
      "src": "/navigator-assets/pinacoteca-hero.svg",
      "alt": "Illustrazione dimostrativa di una sala"
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

- `schemaVersion`: deve valere `2`;
- `venueId`: ObjectId MongoDB della Venue pubblicata per il museo;
- `productTitle`: nome del prodotto mostrato nell’interfaccia e nel titolo della pagina;
- `museumTitle`: nome del museo;
- `subtitle`: testo breve facoltativo;
- `logo` e `heroImage`: asset facoltativi con testo alternativo;
- `theme`: colori esadecimali `#RRGGBB` per identità principale, accento e superficie.

Logo, immagine hero e palette del museo vengono applicati a Library, generazione, shell dell’app e schermata immersiva di esecuzione. Login e selettore musei usano invece la configurazione neutrale di piattaforma. Il colore del testo sui pulsanti principali viene calcolato automaticamente per mantenere il contrasto.

## Configurazione inclusa e secondo esempio

La configurazione neutrale è in `clients/navigator/public/navigator-platform/`. La Pinacoteca è in `clients/navigator/public/navigator-configs/496f78e51b8861a9800749a7/`.

Un secondo pacchetto museale completo e indipendente è disponibile in `docs/examples/navigator-museo-aurora/`. Il museo Aurora è un esempio di configurazione e non viene mostrato finché nel database non esiste la Venue corrispondente e l’utente non possiede una sua visita.

Gli asset inclusi sono illustrazioni schematiche dimostrative, non marchi, fotografie o planimetrie ufficiali.

## Verifica

Prima del deploy eseguire:

```bash
npm --prefix clients/navigator run check:config
```

Il controllo verifica configurazione di piattaforma, configurazioni museali incluse, schemi, colori, sicurezza dei percorsi ed esistenza degli asset.

Per validare una directory esterna:

```bash
node clients/navigator/scripts/check-config.mjs /percorso/alla/configurazione
```

## Uso senza ricompilazione

Dopo aver costruito il client, impostare `NAVIGATOR_CONFIG_DIR` sulla directory radice che contiene `navigator-platform/` e `navigator-configs/`:

```dotenv
NAVIGATOR_CONFIG_DIR=/srv/artaround/navigator-runtime
```

Express serve la piattaforma su `/navigator-platform/...`, ogni museo su `/navigator-configs/:venueId/...` e l’app invariata su `/navigator/`. I JSON sono senza cache; gli asset sono cacheabili. La vecchia route `/navigator.config.json` resta disponibile per compatibilità.

Se nella directory esterna manca un file, il server usa la configurazione inclusa nella build. Se manca la configurazione di un museo posseduto, l’interfaccia crea un’identità di fallback neutrale con il nome della Venue; la Library resta comunque accessibile.

Per Docker Compose, montare la directory nel container con un override locale:

```yaml
services:
  backend:
    volumes:
      - ./navigator-runtime:/app/runtime/navigator:ro
    environment:
      NAVIGATOR_CONFIG_DIR: /app/runtime/navigator
```

Riavviare il processo Node quando cambia il percorso configurato. La modifica di JSON o asset non richiede una nuova build: un refresh ricarica l’identità. Ogni cartella e il relativo `venueId` devono corrispondere alla Venue pubblicata nel database.
