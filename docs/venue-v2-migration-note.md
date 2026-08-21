# Venue v2 migration note

Durante il refactoring coesistono temporaneamente due domini fisici:

- legacy: `Museum` + `MuseumLayout` + `MuseumLayoutRevision.itemPlacements`, ancora usati da Visit/generator/navigation correnti;
- v2: `Organization` + `Venue` + `VenueTarget` + `VenueRelease` + `LayoutRevision.venueTargetPlacements`.

Il dominio v2 e canonico per il nuovo codice. `VenueTarget` identifica una occorrenza fisica stabile associata a un `Subject`; non esiste unicita `(venueId, subjectId)`. `VenueRelease` versiona availability, recognition media e pre-visit information, mentre `LayoutRevision` versiona mappa, Place, Connection, routing attributes/presets e placement dei VenueTarget.

Il graph routing (`graphRouting.service.js`) e gia fisico e viene riusato senza duplicazione. Il legacy layout rimane soltanto finche Visit, generator, learning e navigation non vengono migrati; al cutover finale `MuseumLayout*`, `ItemPlacement` e la recognition image legacy su `ItemRevision` verranno eliminati.

L'infrastruttura fisica pubblicata e leggibile read-only anche da chi non possiede la Venue. Working release e target non ancora rilasciati restano invece visibili soltanto agli operatori autorizzati.
