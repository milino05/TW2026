import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function selected(value, current) { return String(value || "") === String(current || "") ? "selected" : ""; }
function id(value) { return String(value?._id || value || ""); }
function percent(value, max = 100) { return Math.max(2, Math.min(max - 2, Number(value ?? 0.5) * max)); }
function metricLabel(connection) {
  if (connection.metricMode === "geometry_derived") return "Distanza dalla geometria calibrata";
  if (connection.metricMode === "length_constrained") return "Lunghezza vincolata";
  return "Distanza manuale";
}

export const venueSpatialMixin = {
  physicalDefinitions() { return this.data.physicalVocabulary?.definitions || { placeTypes: [], connectionTypes: [], physicalAttributes: [], routingProfiles: [] }; },

  renderMapPreview() {
    const layout = this.data.layout;
    const floors = layout?.floors || [];
    const places = layout?.places || [];
    const connections = layout?.connections || [];
    if (!floors.length) return `<div class="venue-map-preview empty-state"><h3>Nessun piano</h3><p>Aggiungi il primo piano per iniziare a modellare la sede.</p></div>`;
    const floor = floors[0];
    const floorPlaces = places.filter((place) => id(place.floorId) === id(floor._id));
    const byId = new Map(floorPlaces.map((place) => [id(place._id), place]));
    const lines = connections.map((connection) => {
      const from = byId.get(id(connection.fromPlaceId));
      const to = byId.get(id(connection.toPlaceId));
      if (!from || !to) return "";
      const points = connection.geometry?.points?.length
        ? connection.geometry.points
        : [from.position, to.position];
      const polyline = points.map((point) => `${percent(point.x)},${percent(point.y, 70)}`).join(" ");
      return `<polyline points="${polyline}" fill="none"></polyline>`;
    }).join("");
    const nodes = floorPlaces.map((place, index) => `<g><circle cx="${percent(place.position?.x)}" cy="${percent(place.position?.y, 70)}" r="2.8"></circle><text x="${percent(place.position?.x)}" y="${percent(place.position?.y, 70) + 0.9}" text-anchor="middle">${index + 1}</text></g>`).join("");
    const legend = floorPlaces.map((place, index) => `<li><span>${index + 1}</span>${escapeHtml(place.label || `Luogo ${index + 1}`)}</li>`).join("");
    return `<div class="venue-map-preview"><div class="venue-map-heading"><div><span class="eyebrow">Anteprima</span><h3>${escapeHtml(floor.label)}</h3><p>La preview rappresenta il Layout; non localizza automaticamente il visitatore.</p></div><span class="count">${floorPlaces.length} luoghi</span></div><div class="map-canvas">${floor.mapAsset?.url ? `<img src="${escapeHtml(floor.mapAsset.url)}" alt="Planimetria ${escapeHtml(floor.label)}">` : ""}<svg viewBox="0 0 100 70" role="img" aria-label="Schema dei luoghi e dei collegamenti">${lines}${nodes}</svg></div><ol class="map-legend">${legend}</ol></div>`;
  },

  renderFloors(editable) {
    const floors = this.data.layout?.floors || [];
    const cards = floors.map((floor) => `<article class="venue-command-card"><header><div><span class="eyebrow">Piano</span><h3>${escapeHtml(floor.label)}</h3></div>${editable ? `<button class="danger small" type="button" data-remove-floor="${escapeHtml(id(floor._id))}">Rimuovi</button>` : ""}</header><dl class="venue-command-facts"><div><dt>Planimetria</dt><dd>${floor.mapAsset ? `${floor.mapAsset.width}×${floor.mapAsset.height}px` : "Non caricata"}</dd></div><div><dt>Calibrazione</dt><dd>${floor.calibration ? `${Number(floor.calibration.metersPerPixel).toPrecision(4)} m/px` : "Non calibrato"}</dd></div></dl>${floor.mapAsset && editable ? `<details><summary>Calibra con una distanza nota</summary><form data-calibrate-floor="${escapeHtml(id(floor._id))}" class="venue-inline-form"><div class="venue-coordinate-grid"><label>Da X<input name="fromX" type="number" min="0" max="1" step="0.001" value="0.1" required></label><label>Da Y<input name="fromY" type="number" min="0" max="1" step="0.001" value="0.1" required></label><label>A X<input name="toX" type="number" min="0" max="1" step="0.001" value="0.9" required></label><label>A Y<input name="toY" type="number" min="0" max="1" step="0.001" value="0.1" required></label></div><label>Distanza reale (m)<input name="distanceMeters" type="number" min="0.01" step="0.01" required></label><button>${icon("check", { size: 15 })} Calibra</button></form></details>` : ""}</article>`).join("");
    return `<section class="venue-command-block"><div class="section-heading compact"><div><h3>Piani</h3><p>I piani sono contenitori spaziali del Layout. La planimetria e la calibrazione restano proprietà del piano.</p></div><span class="count">${floors.length}</span></div><div class="venue-command-grid">${cards || `<div class="empty-state compact"><h4>Nessun piano</h4></div>`}</div>${editable ? `<form data-add-floor class="venue-inline-create"><label>Nome del piano<input name="label" required placeholder="Es. Piano terra"></label><button>${icon("plus", { size: 15 })} Aggiungi piano</button></form>` : ""}</section>`;
  },

  renderPlaces(editable) {
    const layout = this.data.layout;
    const floors = layout?.floors || [];
    const places = layout?.places || [];
    const definitions = this.physicalDefinitions();
    const floorOptions = floors.map((floor) => `<option value="${escapeHtml(id(floor._id))}">${escapeHtml(floor.label)}</option>`).join("");
    const typeOptions = definitions.placeTypes.map((type) => `<option value="${escapeHtml(type.definitionId)}">${escapeHtml(type.label)}</option>`).join("");
    const typeById = new Map(definitions.placeTypes.map((type) => [String(type.definitionId), type]));
    const floorById = new Map(floors.map((floor) => [id(floor._id), floor]));
    const cards = places.map((place) => `<article class="venue-command-card"><header><div><span class="eyebrow">${escapeHtml(typeById.get(String(place.placeTypeDefinitionId))?.label || "Tipo non disponibile")}</span><h3>${escapeHtml(place.label || "Luogo senza nome")}</h3></div>${editable ? `<button class="danger small" type="button" data-remove-place="${escapeHtml(id(place._id))}">Rimuovi</button>` : ""}</header><p class="note">${escapeHtml(floorById.get(id(place.floorId))?.label || "Piano non disponibile")} · x ${Number(place.position?.x ?? 0).toFixed(3)} · y ${Number(place.position?.y ?? 0).toFixed(3)}</p>${editable ? `<details><summary>Modifica luogo</summary><form data-place-editor="${escapeHtml(id(place._id))}" class="venue-inline-form"><label>Nome<input name="label" value="${escapeHtml(place.label || "")}"></label><label>Tipo<select name="placeTypeDefinitionId">${definitions.placeTypes.map((type) => `<option value="${escapeHtml(type.definitionId)}" ${selected(type.definitionId, place.placeTypeDefinitionId)}>${escapeHtml(type.label)}</option>`).join("")}</select></label><div class="venue-coordinate-grid"><label>X<input name="x" type="number" min="0" max="1" step="0.001" value="${place.position?.x ?? 0.5}" required></label><label>Y<input name="y" type="number" min="0" max="1" step="0.001" value="${place.position?.y ?? 0.5}" required></label></div><button>${icon("check", { size: 15 })} Salva luogo</button></form></details>` : ""}</article>`).join("");
    return `<section class="venue-command-block"><div class="section-heading compact"><div><h3>Luoghi</h3><p>Sale, ingressi, servizi e altri punti fisici sono istanze dei tipi definiti nel PhysicalVocabulary pinzato.</p></div><span class="count">${places.length}</span></div><div class="venue-command-grid">${cards || `<div class="empty-state compact"><h4>Nessun luogo</h4></div>`}</div>${editable && floors.length && definitions.placeTypes.length ? `<form data-add-place class="venue-inline-create"><label>Nome<input name="label" placeholder="Es. Sala 1"></label><label>Piano<select name="floorId" required>${floorOptions}</select></label><label>Tipo<select name="placeTypeDefinitionId" required>${typeOptions}</select></label><div class="venue-coordinate-grid"><label>X<input name="x" type="number" min="0" max="1" step="0.001" value="0.5" required></label><label>Y<input name="y" type="number" min="0" max="1" step="0.001" value="0.5" required></label></div><button>${icon("plus", { size: 15 })} Aggiungi luogo</button></form>` : ""}</section>`;
  },

  renderConnections(editable) {
    const layout = this.data.layout;
    const places = layout?.places || [];
    const connections = layout?.connections || [];
    const definitions = this.physicalDefinitions();
    const placeById = new Map(places.map((place) => [id(place._id), place]));
    const connectionTypeById = new Map(definitions.connectionTypes.map((type) => [String(type.definitionId), type]));
    const placeOptions = places.map((place) => `<option value="${escapeHtml(id(place._id))}">${escapeHtml(place.label || id(place._id))}</option>`).join("");
    const typeOptions = `<option value="">Senza tipo specifico</option>${definitions.connectionTypes.map((type) => `<option value="${escapeHtml(type.definitionId)}">${escapeHtml(type.label)}</option>`).join("")}`;
    const cards = connections.map((connection) => `<article class="venue-command-card"><header><div><span class="eyebrow">${escapeHtml(connectionTypeById.get(String(connection.connectionTypeDefinitionId))?.label || "Collegamento")}</span><h3>${escapeHtml(placeById.get(id(connection.fromPlaceId))?.label || "?")} → ${escapeHtml(placeById.get(id(connection.toPlaceId))?.label || "?")}</h3></div>${editable ? `<button class="danger small" type="button" data-remove-connection="${escapeHtml(id(connection._id))}">Rimuovi</button>` : ""}</header><p>${escapeHtml(metricLabel(connection))} · ${Number(connection.distanceMeters || 0).toFixed(1)} m · ${connection.directionality === "directed" ? "una direzione" : "bidirezionale"}</p>${editable ? `<details><summary>Modifica collegamento</summary><form data-connection-editor="${escapeHtml(id(connection._id))}" class="venue-inline-form"><label>Tipo<select name="connectionTypeDefinitionId"><option value="">Senza tipo specifico</option>${definitions.connectionTypes.map((type) => `<option value="${escapeHtml(type.definitionId)}" ${selected(type.definitionId, connection.connectionTypeDefinitionId)}>${escapeHtml(type.label)}</option>`).join("")}</select></label><label>Direzione<select name="directionality"><option value="bidirectional" ${selected("bidirectional", connection.directionality)}>Entrambe</option><option value="directed" ${selected("directed", connection.directionality)}>Solo da → a</option></select></label><label>Misurazione<select name="metricMode"><option value="manual_override" ${selected("manual_override", connection.metricMode)}>Distanza manuale</option><option value="geometry_derived" ${selected("geometry_derived", connection.metricMode)}>Da geometria calibrata</option><option value="length_constrained" ${selected("length_constrained", connection.metricMode)}>Lunghezza vincolata</option></select></label><label>Distanza (m)<input name="distanceMeters" type="number" min="0.1" step="0.1" value="${connection.distanceMeters || ""}"></label><label>Ritardo aggiuntivo (s)<input name="additionalDelaySeconds" type="number" min="0" step="1" value="${connection.additionalDelaySeconds || 0}"></label><label>Istruzione andata<input name="forward" value="${escapeHtml(connection.instructions?.forward || "")}"></label><label>Istruzione ritorno<input name="backward" value="${escapeHtml(connection.instructions?.backward || "")}"></label><button>${icon("check", { size: 15 })} Salva collegamento</button></form></details>` : ""}</article>`).join("");
    return `<section class="venue-command-block"><div class="section-heading compact"><div><h3>Collegamenti</h3><p>Il backend conserva direzione, metrica, geometria e caratteristiche fisiche; il routing usa questi dati senza logica hardcoded nel client.</p></div><span class="count">${connections.length}</span></div><div class="venue-command-grid">${cards || `<div class="empty-state compact"><h4>Nessun collegamento</h4></div>`}</div>${editable && places.length >= 2 ? `<form data-add-connection class="venue-inline-create"><label>Da<select name="fromPlaceId" required>${placeOptions}</select></label><label>A<select name="toPlaceId" required>${placeOptions}</select></label><label>Tipo<select name="connectionTypeDefinitionId">${typeOptions}</select></label><label>Direzione<select name="directionality"><option value="bidirectional">Entrambe</option><option value="directed">Solo da → a</option></select></label><label>Misurazione<select name="metricMode"><option value="manual_override">Distanza manuale</option><option value="geometry_derived">Da geometria calibrata</option><option value="length_constrained">Lunghezza vincolata</option></select></label><label>Distanza (m)<input name="distanceMeters" type="number" min="0.1" step="0.1" value="1"></label><label>Ritardo aggiuntivo (s)<input name="additionalDelaySeconds" type="number" min="0" step="1" value="0"></label><button>${icon("plus", { size: 15 })} Collega luoghi</button></form>` : ""}</section>`;
  },

  renderTargetPlacements(editable) {
    const places = this.data.layout?.places || [];
    if (!places.length || !this.data.targets.length) return "";
    const placeOptionsFor = (current) => places.map((place) => `<option value="${escapeHtml(id(place._id))}" ${selected(place._id, current)}>${escapeHtml(place.label || id(place._id))}</option>`).join("");
    const placementByTarget = new Map((this.data.layout?.venueTargetPlacements || []).map((placement) => [id(placement.venueTargetId), placement]));
    const cards = this.data.targets.map((target) => {
      const placement = placementByTarget.get(id(target.id));
      return `<article class="venue-command-card"><header><div><span class="eyebrow">Oggetto</span><h3>${escapeHtml(target.label)}</h3></div></header>${editable ? `<form data-target-placement="${escapeHtml(id(target.id))}" class="venue-inline-form"><label>Luogo principale<select name="primaryPlaceId">${placeOptionsFor(placement?.primaryPlaceId)}</select></label><button>${icon("check", { size: 15 })} Colloca oggetto</button></form>` : `<p>${escapeHtml(places.find((place) => id(place._id) === id(placement?.primaryPlaceId))?.label || "Non collocato")}</p>`}</article>`;
    }).join("");
    return `<section class="venue-command-block"><div class="section-heading compact"><div><h3>Collocazione degli oggetti</h3><p>La collocazione fisica è separata dall'identità Subject e dai contenuti Item.</p></div></div><div class="venue-command-grid">${cards}</div></section>`;
  },

  renderMapAndPlaces(editable) {
    if (!this.data.layout) return `<section class="venue-section" id="venue-map"><div class="empty-state"><h3>Nessun Layout disponibile</h3><p>Completa prima la configurazione iniziale della sede.</p></div></section>`;
    const vocabulary = this.data.physicalVocabulary;
    return `<section class="venue-section" id="venue-map"><div class="section-heading"><div><span class="eyebrow">Spazi e mappa</span><h2>Modello fisico della sede</h2><p>Piani, luoghi, collegamenti e collocazioni sono dati logistici: non diventano Item.</p></div></div>${vocabulary ? `<aside class="venue-vocabulary-context"><span class="eyebrow">PhysicalVocabulary pinzato</span><strong>${escapeHtml(vocabulary.name)}</strong><small>v${vocabulary.version} · revisione ${escapeHtml(vocabulary.status)}</small></aside>` : ""}${this.renderMapPreview()}${this.renderFloors(editable)}${this.renderPlaces(editable)}${this.renderConnections(editable)}${this.renderTargetPlacements(editable)}</section>`;
  },
};
