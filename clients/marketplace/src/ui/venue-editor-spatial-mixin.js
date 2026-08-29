import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function selected(value, current) { return String(value ?? "") === String(current ?? "") ? "selected" : ""; }
function id(value) { return String(value?._id || value?.id || value || ""); }
function pct(value) { return Math.max(0, Math.min(100, Number(value ?? .5) * 100)); }
function metricLabel(connection) {
  if (connection.metricMode === "geometry_derived") return "Distanza dalla geometria calibrata";
  if (connection.metricMode === "length_constrained") return "Lunghezza vincolata";
  return "Distanza manuale";
}
function valueForAttribute(entity, definitionId) {
  return (entity.attributeValues || []).find((entry) => String(entry.physicalAttributeDefinitionId) === String(definitionId))?.value;
}
function attributeInput(definition, current) {
  if (definition.dataType === "boolean") {
    return `<select name="value"><option value="" ${current === undefined || current === null ? "selected" : ""}>Non verificato</option><option value="true" ${current === true ? "selected" : ""}>Sì</option><option value="false" ${current === false ? "selected" : ""}>No</option></select>`;
  }
  if (definition.dataType === "choice") {
    const options = (definition.options || []).map((entry) => `<option value="${escapeHtml(entry.value)}" ${selected(entry.value, current)}>${escapeHtml(entry.label)}</option>`).join("");
    return `<select name="value"><option value="">Non verificato</option>${options}</select>`;
  }
  if (definition.dataType === "number") {
    return `<input name="value" type="number" step="any" value="${current === undefined || current === null ? "" : escapeHtml(current)}" placeholder="Non verificato">`;
  }
  return `<input name="value" value="${current === undefined || current === null ? "" : escapeHtml(current)}" placeholder="Non verificato">`;
}
function attributeEditors({ definitions, entity, entityType, entityId }) {
  const applicable = (definitions.physicalAttributes || []).filter((definition) => [entityType, "both"].includes(definition.appliesTo));
  if (!applicable.length) return "";
  return `<details class="venue-physical-attributes"><summary>Caratteristiche fisiche</summary><div class="venue-attribute-list">${applicable.map((definition) => {
    const current = valueForAttribute(entity, definition.definitionId);
    return `<form data-physical-attribute data-entity-type="${escapeHtml(entityType)}" data-entity-id="${escapeHtml(entityId)}" data-definition-id="${escapeHtml(definition.definitionId)}" data-data-type="${escapeHtml(definition.dataType)}" class="venue-attribute-row"><label><span>${escapeHtml(definition.label)}</span><small>${escapeHtml(definition.description || (definition.unit ? `Unità: ${definition.unit}` : "Valore fisico usato dal routing"))}</small>${attributeInput(definition, current)}</label><button class="button-secondary small" type="submit">Salva</button></form>`;
  }).join("")}</div></details>`;
}
function attributeDisplayValue(definition, value) {
  if (value === undefined || value === null) return "Non verificato";
  if (definition.dataType === "boolean") return value ? "Sì" : "No";
  if (definition.dataType === "choice") return (definition.options || []).find((entry) => entry.value === value)?.label || String(value);
  if (definition.dataType === "number") return `${value}${definition.unit ? ` ${definition.unit}` : ""}`;
  return String(value);
}
function attributeSummary({ definitions, entity, entityType }) {
  const applicable = (definitions.physicalAttributes || []).filter((definition) => [entityType, "both"].includes(definition.appliesTo));
  const authored = applicable.filter((definition) => valueForAttribute(entity, definition.definitionId) !== undefined);
  if (!authored.length) return "";
  return `<details class="venue-physical-attributes"><summary>Caratteristiche fisiche</summary><dl class="venue-attribute-summary">${authored.map((definition) => `<div><dt>${escapeHtml(definition.label)}</dt><dd>${escapeHtml(attributeDisplayValue(definition, valueForAttribute(entity, definition.definitionId)))}</dd></div>`).join("")}</dl></details>`;
}

export const venueSpatialMixin = {
  physicalDefinitions() { return this.data.physicalVocabulary?.definitions || { placeTypes: [], connectionTypes: [], physicalAttributes: [], routingProfiles: [] }; },

  activeFloorId() {
    const floors = this.data.layout?.floors || [];
    const ids = new Set(floors.map((floor) => id(floor._id)));
    return ids.has(id(this.selectedFloorId)) ? id(this.selectedFloorId) : (ids.values().next().value || null);
  },

  activeFloor() {
    const floorId = this.activeFloorId();
    return (this.data.layout?.floors || []).find((floor) => id(floor._id) === id(floorId)) || null;
  },

  renderMapActionStatus() {
    const action = this.pendingMapAction;
    if (!action) return `<p class="venue-map-instruction">Seleziona uno strumento oppure un luogo per modificarne la posizione.</p>`;
    if (action.type === "create-place") return `<p class="venue-map-instruction active"><strong>Posiziona “${escapeHtml(action.label || "nuovo luogo")}”</strong> · fai clic nel punto corretto della mappa.</p>`;
    if (action.type === "move-place") return `<p class="venue-map-instruction active"><strong>Sposta luogo</strong> · fai clic sulla nuova posizione.</p>`;
    if (action.type === "placing-slot") return `<p class="venue-map-instruction active"><strong>Posiziona slot</strong> · seleziona il Place che ospiterà “${escapeHtml(action.label || "il nuovo slot")}”.</p>`;
    if (action.type === "connect") {
      const count = Number(Boolean(action.fromPlaceId)) + Number(Boolean(action.toPlaceId));
      return `<p class="venue-map-instruction active"><strong>Collega luoghi</strong> · ${count === 0 ? "seleziona il primo luogo" : count === 1 ? "ora seleziona il secondo luogo, anche su un altro piano" : "configura il collegamento nel pannello sotto la mappa"}.</p>`;
    }
    if (action.type === "calibrate") return `<p class="venue-map-instruction active"><strong>Calibra planimetria</strong> · ${(action.points || []).length === 0 ? "seleziona il primo estremo di una distanza nota" : (action.points || []).length === 1 ? "seleziona il secondo estremo" : "inserisci la distanza reale nel pannello sotto la mappa"}.</p>`;
    if (action.type === "geometry") return `<p class="venue-map-instruction active"><strong>Disegna il percorso</strong> · ogni clic aggiunge un punto intermedio; ingresso e uscita restano agganciati ai Place.</p>`;
    return "";
  },

  renderMapPreview(editable) {
    const layout = this.data.layout;
    const floors = layout?.floors || [];
    const places = layout?.places || [];
    const connections = layout?.connections || [];
    if (!floors.length) return `<div class="venue-map-preview empty-state"><h3>Nessun piano</h3><p>Aggiungi il primo piano per iniziare a modellare la sede.</p></div>`;
    const floor = this.activeFloor();
    const floorId = id(floor?._id);
    const floorPlaces = places.filter((place) => id(place.floorId) === floorId);
    const byId = new Map(floorPlaces.map((place) => [id(place._id), place]));
    const slotCountByPlace = new Map();
    for (const slot of layout.exhibitSlots || []) {
      const placeId = id(slot.placeId);
      slotCountByPlace.set(placeId, (slotCountByPlace.get(placeId) || 0) + 1);
    }
    const floorOptions = floors.map((entry) => `<option value="${escapeHtml(id(entry._id))}" ${selected(id(entry._id), floorId)}>${escapeHtml(entry.label)}</option>`).join("");
    const geometryState = this.geometryAuthoringState?.();
    const editingConnectionId = geometryState && id(geometryState.floor?._id) === floorId ? id(geometryState.connection._id) : null;
    const lines = connections.map((connection) => {
      if (editingConnectionId && id(connection._id) === editingConnectionId) return "";
      const from = byId.get(id(connection.fromPlaceId));
      const to = byId.get(id(connection.toPlaceId));
      if (!from || !to) return "";
      const points = connection.geometry?.points?.length ? connection.geometry.points : [from.position, to.position];
      const pointList = points.map((point) => `${pct(point.x)},${pct(point.y)}`).join(" ");
      const active = id(this.selectedConnectionId) === id(connection._id);
      return `<polyline class="connection-line${active ? " selected" : ""}" points="${pointList}" vector-effect="non-scaling-stroke"></polyline><polyline class="connection-hit" data-map-connection="${escapeHtml(id(connection._id))}" points="${pointList}" vector-effect="non-scaling-stroke" tabindex="0" role="button" aria-label="Seleziona collegamento"></polyline>`;
    }).join("");
    const geometryOverlay = geometryState && id(geometryState.floor?._id) === floorId
      ? `<g class="map-geometry-preview"><polyline points="${geometryState.points.map((point) => `${pct(point.x)},${pct(point.y)}`).join(" ")}" vector-effect="non-scaling-stroke"></polyline>${geometryState.points.slice(1, -1).map((point) => `<circle cx="${pct(point.x)}" cy="${pct(point.y)}" r="1.1"></circle>`).join("")}</g>`
      : "";
    const calibration = this.pendingMapAction?.type === "calibrate" && id(this.pendingMapAction.floorId) === floorId ? this.pendingMapAction.points || [] : [];
    const calibrationOverlay = calibration.length
      ? `<g class="map-calibration-preview">${calibration.length === 2 ? `<line x1="${pct(calibration[0].x)}" y1="${pct(calibration[0].y)}" x2="${pct(calibration[1].x)}" y2="${pct(calibration[1].y)}"></line>` : ""}${calibration.map((point) => `<circle cx="${pct(point.x)}" cy="${pct(point.y)}" r="1.2"></circle>`).join("")}</g>`
      : "";
    const nodes = floorPlaces.map((place, index) => {
      const selectedPlace = id(this.selectedMapPlaceId) === id(place._id);
      const endpoint = [this.pendingMapAction?.fromPlaceId, this.pendingMapAction?.toPlaceId].some((value) => id(value) === id(place._id))
        || (geometryState && [geometryState.from, geometryState.to].some((entry) => id(entry?._id) === id(place._id)));
      const slotCount = slotCountByPlace.get(id(place._id)) || 0;
      const label = `${place.label || `Luogo ${index + 1}`}${slotCount ? `, ${slotCount} slot` : ""}`;
      return `<button class="map-place-node${selectedPlace ? " selected" : ""}${endpoint ? " endpoint" : ""}" type="button" data-map-place="${escapeHtml(id(place._id))}" style="left:${pct(place.position?.x)}%;top:${pct(place.position?.y)}%" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><span>${index + 1}</span>${slotCount ? `<small>${slotCount}</small>` : ""}</button>`;
    }).join("");
    const ratio = floor?.mapAsset?.width && floor?.mapAsset?.height ? `${floor.mapAsset.width}/${floor.mapAsset.height}` : "10/7";
    const toolbar = editable ? `<div class="venue-map-toolbar"><button class="button-secondary" type="button" data-show-spatial-tab="places">${icon("plus", { size: 15 })} Nuovo luogo</button><button class="button-secondary" type="button" data-map-tool="connect" ${places.length < 2 ? "disabled" : ""}>${icon("link", { size: 15 })} Collega</button><button class="button-secondary" type="button" data-start-slot ${places.length ? "" : "disabled"}>${icon("pin", { size: 15 })} Nuovo slot</button><button class="button-secondary" type="button" data-map-tool="calibrate" ${floor?.mapAsset ? "" : "disabled"}>${icon("ruler", { size: 15 })} Calibra</button>${this.pendingMapAction ? `<button class="button-secondary" type="button" data-cancel-map-action>Annulla · Esc</button>` : ""}</div>` : "";
    return `<div class="venue-map-preview"><div class="venue-map-heading"><div><label class="venue-floor-picker"><span>Piano</span><select data-floor-select>${floorOptions}</select></label><small>La mappa descrive la sede; non traccia la posizione del visitatore.</small></div><span class="count">${floorPlaces.length} luoghi · ${(layout.exhibitSlots || []).filter((entry) => id(entry.placeId) && floorPlaces.some((place) => id(place._id) === id(entry.placeId))).length} slot</span></div>${toolbar}${this.renderMapActionStatus()}<div class="map-canvas map-canvas--authoring" data-map-surface data-floor-id="${escapeHtml(floorId)}" style="--map-ratio:${ratio}">${floor.mapAsset?.url ? `<img src="${escapeHtml(floor.mapAsset.url)}" alt="Planimetria ${escapeHtml(floor.label)}" draggable="false">` : `<div class="map-canvas-placeholder"><strong>Nessuna planimetria</strong><span>La griglia resta utilizzabile per impostare la struttura logica.</span></div>`}<svg viewBox="0 0 100 100" preserveAspectRatio="none">${lines}${geometryOverlay}${calibrationOverlay}</svg>${nodes}</div></div>`;
  },

  renderCalibrationComposer(editable) {
    const action = this.pendingMapAction;
    if (!editable || action?.type !== "calibrate" || action.points?.length !== 2) return "";
    const floor = (this.data.layout?.floors || []).find((entry) => id(entry._id) === id(action.floorId));
    return `<section class="venue-map-composer"><div><span class="eyebrow">Calibrazione</span><h3>Distanza reale sulla planimetria</h3><p>Hai indicato i due estremi sulla mappa. Inserisci soltanto la distanza che conosci nel mondo reale.</p></div><form data-calibration-distance class="venue-inline-form"><label>Distanza reale (m)<input name="distanceMeters" type="number" min="0.01" step="0.01" required autofocus></label><button type="submit">${icon("check", { size: 15 })} Calibra ${escapeHtml(floor?.label || "piano")}</button></form></section>`;
  },

  renderGeometryComposer(editable) {
    if (!editable) return "";
    const state = this.geometryAuthoringState?.();
    if (!state) return "";
    const measured = Number.isFinite(state.measuredDistanceMeters) ? `${state.measuredDistanceMeters.toFixed(2)} m` : "Scala non disponibile";
    const constrained = this.pendingMapAction.metricMode === "length_constrained";
    const derived = this.pendingMapAction.metricMode === "geometry_derived";
    const canSave = constrained ? state.constraintSatisfied : (!derived || Number.isFinite(state.measuredDistanceMeters));
    const constraint = constrained
      ? `<div class="venue-geometry-metric ${state.constraintSatisfied ? "valid" : "invalid"}"><span>Lunghezza richiesta</span><strong>${state.requestedDistanceMeters.toFixed(2)} m</strong><small>${state.constraintSatisfied ? "Vincolo soddisfatto" : `Disegnata: ${measured} · tolleranza ±${state.toleranceMeters.toFixed(2)} m`}</small></div>`
      : `<div class="venue-geometry-metric"><span>Lunghezza disegnata</span><strong>${measured}</strong><small>${derived ? "Questa misura diventerà la distanza di routing." : "La distanza di routing manuale resta separata dalla forma disegnata."}</small></div>`;
    return `<section class="venue-map-composer venue-geometry-composer"><div><span class="eyebrow">Geometria del collegamento</span><h3>${escapeHtml(state.from.label || "Luogo")} → ${escapeHtml(state.to.label || "Luogo")}</h3><p>ArtAround non inventa curve: aggiungi sulla mappa solo i punti necessari a seguire il percorso reale.</p>${constraint}</div><div class="venue-geometry-actions"><span class="count">${Math.max(0, state.points.length - 2)} punti intermedi</span><div class="button-row"><button class="button-secondary" type="button" data-geometry-undo ${state.points.length <= 2 ? "disabled" : ""}>Annulla ultimo punto</button><button class="button-secondary" type="button" data-geometry-clear ${state.points.length <= 2 ? "disabled" : ""}>Linea diretta</button><button type="button" data-save-geometry ${canSave ? "" : "disabled"}>${icon("check", { size: 15 })} Salva percorso</button></div></div></section>`;
  },

  renderFloors(editable) {
    const floors = this.data.layout?.floors || [];
    const cards = floors.map((floor) => `<article class="venue-command-card${id(floor._id) === id(this.activeFloorId()) ? " selected" : ""}"><header><div><span class="eyebrow">Piano</span><h3>${escapeHtml(floor.label)}</h3></div><button class="button-secondary small" type="button" data-select-floor="${escapeHtml(id(floor._id))}">Apri sulla mappa</button></header><dl class="venue-command-facts"><div><dt>Planimetria</dt><dd>${floor.mapAsset ? `${floor.mapAsset.width}×${floor.mapAsset.height}px` : "Non caricata"}</dd></div><div><dt>Scala</dt><dd>${floor.calibration ? "Calibrata" : "Da calibrare"}</dd></div></dl>${editable ? `<label class="venue-floor-plan-upload"><span>${floor.mapAsset ? "Sostituisci planimetria" : "Carica planimetria"}</span><small>JPEG, PNG o WebP · massimo 4 MB. Dimensioni e riferimento sono ricavati automaticamente.</small><input type="file" accept="image/jpeg,image/png,image/webp" data-floor-plan-input data-floor-id="${escapeHtml(id(floor._id))}"></label><button class="danger small" type="button" data-remove-floor="${escapeHtml(id(floor._id))}">Rimuovi piano</button>` : ""}</article>`).join("");
    return `<section class="venue-command-block"><div class="section-heading compact"><div><h3>Piani e planimetrie</h3><p>Carica il file del piano: ArtAround lo gestisce e collega al Layout senza URL o dimensioni manuali.</p></div><span class="count">${floors.length}</span></div><div class="venue-command-grid">${cards || `<div class="empty-state compact"><h4>Nessun piano</h4></div>`}</div>${editable ? `<form data-add-floor class="venue-inline-create"><label>Nome del piano<input name="label" required placeholder="Es. Piano terra"></label><button>${icon("plus", { size: 15 })} Aggiungi piano</button></form>` : ""}</section>`;
  },

  renderPlaces(editable) {
    const layout = this.data.layout;
    const floor = this.activeFloor();
    const floorId = id(floor?._id);
    const places = (layout?.places || []).filter((place) => id(place.floorId) === floorId);
    const definitions = this.physicalDefinitions();
    const typeById = new Map(definitions.placeTypes.map((type) => [String(type.definitionId), type]));
    const cards = places.map((place) => `<article class="venue-command-card${id(this.selectedMapPlaceId) === id(place._id) ? " selected" : ""}"><header><div><span class="eyebrow">${escapeHtml(typeById.get(String(place.placeTypeDefinitionId))?.label || "Tipo non disponibile")}</span><h3>${escapeHtml(place.label || "Luogo senza nome")}</h3></div>${editable ? `<button class="danger small" type="button" data-remove-place="${escapeHtml(id(place._id))}">Rimuovi</button>` : ""}</header><p class="note">${escapeHtml(floor?.label || "Piano")}</p>${editable ? `<div class="button-row"><button class="button-secondary small" type="button" data-position-place="${escapeHtml(id(place._id))}">${icon("pin", { size: 14 })} Sposta sulla mappa</button></div><details><summary>Nome e tipo</summary><form data-place-editor="${escapeHtml(id(place._id))}" class="venue-inline-form"><label>Nome<input name="label" value="${escapeHtml(place.label || "")}"></label><label>Tipo<select name="placeTypeDefinitionId">${definitions.placeTypes.map((type) => `<option value="${escapeHtml(type.definitionId)}" ${selected(type.definitionId, place.placeTypeDefinitionId)}>${escapeHtml(type.label)}</option>`).join("")}</select></label><button>${icon("check", { size: 15 })} Salva</button></form></details>${attributeEditors({ definitions, entity: place, entityType: "place", entityId: id(place._id) })}` : attributeSummary({ definitions, entity: place, entityType: "place" })}</article>`).join("");
    const create = editable && floor && definitions.placeTypes.length ? `<form data-place-positioning class="venue-inline-create"><div class="venue-form-intro"><strong>Nuovo luogo su ${escapeHtml(floor.label)}</strong><small>Scegli nome e tipo; la posizione verrà indicata con un clic sulla mappa.</small></div><label>Nome<input name="label" placeholder="Es. Sala 1"></label><label>Tipo<select name="placeTypeDefinitionId" required>${definitions.placeTypes.map((type) => `<option value="${escapeHtml(type.definitionId)}">${escapeHtml(type.label)}</option>`).join("")}</select></label><button>${icon("pin", { size: 15 })} Posiziona sulla mappa</button></form>` : "";
    return `<section class="venue-command-block"><div class="section-heading compact"><div><h3>Luoghi · ${escapeHtml(floor?.label || "nessun piano")}</h3><p>Ogni Place è un punto del grafo fisico e usa un tipo definito dal PhysicalVocabulary.</p></div><span class="count">${places.length}</span></div>${create}<div class="venue-command-grid">${cards || `<div class="empty-state compact"><h4>Nessun luogo su questo piano</h4><p>Usa “Posiziona sulla mappa” per aggiungere il primo.</p></div>`}</div></section>`;
  },

  renderConnectionComposer(editable) {
    const action = this.pendingMapAction;
    if (!editable || action?.type !== "connect") return "";
    const places = this.data.layout?.places || [];
    const byId = new Map(places.map((place) => [id(place._id), place]));
    const from = byId.get(id(action.fromPlaceId));
    const to = byId.get(id(action.toPlaceId));
    if (!from || !to) return `<section class="venue-map-composer"><div><span class="eyebrow">Nuovo collegamento</span><h3>${from ? `Da ${escapeHtml(from.label || "luogo selezionato")}` : "Seleziona due luoghi sulla mappa"}</h3><p>${from ? "Puoi cambiare piano e scegliere il secondo luogo." : "Gli endpoint non vengono scelti tramite ID o menu tecnici."}</p></div></section>`;
    const definitions = this.physicalDefinitions();
    const sameFloor = id(from.floorId) === id(to.floorId);
    const floor = (this.data.layout?.floors || []).find((entry) => id(entry._id) === id(from.floorId));
    const calibrated = sameFloor && Boolean(floor?.calibration);
    const metricOptions = calibrated
      ? `<option value="geometry_derived">Dalla geometria calibrata</option><option value="manual_override">Distanza manuale</option>`
      : `<option value="manual_override">Distanza manuale</option>`;
    return `<section class="venue-map-composer"><div><span class="eyebrow">Nuovo collegamento</span><h3>${escapeHtml(from.label || "Luogo")} → ${escapeHtml(to.label || "Luogo")}</h3><p>${sameFloor ? "Gli estremi sono stati scelti visualmente sullo stesso piano. Dopo la creazione puoi ridisegnare la polyline." : "Collegamento tra piani: la distanza resta esplicita e non viene inventata dalla geometria 2D."}</p></div><form data-connection-composer class="venue-inline-create"><label>Tipo<select name="connectionTypeDefinitionId"><option value="">Senza tipo specifico</option>${definitions.connectionTypes.map((type) => `<option value="${escapeHtml(type.definitionId)}">${escapeHtml(type.label)}</option>`).join("")}</select></label><label>Direzione<select name="directionality"><option value="bidirectional">Entrambe le direzioni</option><option value="directed">Solo da → a</option></select></label><label>Misurazione<select name="metricMode">${metricOptions}</select></label><label>Distanza (m)<input name="distanceMeters" type="number" min="0.1" step="0.1" value="1"></label><label>Ritardo aggiuntivo (s)<input name="additionalDelaySeconds" type="number" min="0" step="1" value="0"></label><button>${icon("plus", { size: 15 })} Crea collegamento</button></form></section>`;
  },

  renderConnections(editable) {
    const layout = this.data.layout;
    const places = layout?.places || [];
    const connections = layout?.connections || [];
    const definitions = this.physicalDefinitions();
    const placeById = new Map(places.map((place) => [id(place._id), place]));
    const floorById = new Map((layout?.floors || []).map((floor) => [id(floor._id), floor]));
    const connectionTypeById = new Map(definitions.connectionTypes.map((type) => [String(type.definitionId), type]));
    const cards = connections.map((connection) => {
      const from = placeById.get(id(connection.fromPlaceId));
      const to = placeById.get(id(connection.toPlaceId));
      const sameFloor = from && to && id(from.floorId) === id(to.floorId);
      const floor = sameFloor ? floorById.get(id(from.floorId)) : null;
      const calibrated = Boolean(floor?.calibration);
      const metricOptions = calibrated
        ? `<option value="manual_override" ${selected("manual_override", connection.metricMode)}>Distanza manuale</option><option value="geometry_derived" ${selected("geometry_derived", connection.metricMode)}>Dalla geometria calibrata</option>${connection.metricMode === "length_constrained" ? `<option value="length_constrained" selected>Lunghezza vincolata</option>` : ""}`
        : `<option value="manual_override" selected>Distanza manuale</option>`;
      const geometryControls = editable && sameFloor ? `<div class="venue-connection-geometry-tools"><button class="button-secondary small" type="button" data-edit-connection-geometry="${escapeHtml(id(connection._id))}">${icon("route", { size: 14 })} Ridisegna percorso</button>${calibrated ? `<form data-length-constraint-authoring="${escapeHtml(id(connection._id))}" class="venue-length-constraint"><label>Lunghezza obiettivo (m)<input name="distanceMeters" type="number" min="0.1" step="0.01" value="${Number(connection.distanceMeters || 1).toFixed(2)}" required></label><button class="button-secondary small" type="submit">${icon("ruler", { size: 14 })} Vincola e disegna</button></form>` : ""}</div>` : "";
      return `<article class="venue-command-card"><header><div><span class="eyebrow">${escapeHtml(connectionTypeById.get(String(connection.connectionTypeDefinitionId))?.label || "Collegamento")}</span><h3>${escapeHtml(from?.label || "?")} → ${escapeHtml(to?.label || "?")}</h3></div>${editable ? `<button class="danger small" type="button" data-remove-connection="${escapeHtml(id(connection._id))}">Rimuovi</button>` : ""}</header><p>${escapeHtml(metricLabel(connection))} · ${Number(connection.distanceMeters || 0).toFixed(1)} m · ${connection.directionality === "directed" ? "una direzione" : "bidirezionale"}</p>${!sameFloor ? `<p class="note">${escapeHtml(floorById.get(id(from?.floorId))?.label || "Piano")} ↕ ${escapeHtml(floorById.get(id(to?.floorId))?.label || "Piano")}</p>` : ""}${geometryControls}${editable ? `<details><summary>Tipo, direzione e istruzioni</summary><form data-connection-editor="${escapeHtml(id(connection._id))}" class="venue-inline-form"><label>Tipo<select name="connectionTypeDefinitionId"><option value="">Senza tipo specifico</option>${definitions.connectionTypes.map((type) => `<option value="${escapeHtml(type.definitionId)}" ${selected(type.definitionId, connection.connectionTypeDefinitionId)}>${escapeHtml(type.label)}</option>`).join("")}</select></label><label>Direzione<select name="directionality"><option value="bidirectional" ${selected("bidirectional", connection.directionality)}>Entrambe</option><option value="directed" ${selected("directed", connection.directionality)}>Solo da → a</option></select></label><label>Misurazione<select name="metricMode">${metricOptions}</select></label><label>Distanza (m)<input name="distanceMeters" type="number" min="0.1" step="0.1" value="${connection.distanceMeters || ""}" ${connection.metricMode === "geometry_derived" ? "readonly" : ""}></label><label>Ritardo aggiuntivo (s)<input name="additionalDelaySeconds" type="number" min="0" step="1" value="${connection.additionalDelaySeconds || 0}"></label><label>Istruzione andata<input name="forward" value="${escapeHtml(connection.instructions?.forward || "")}"></label><label>Istruzione ritorno<input name="backward" value="${escapeHtml(connection.instructions?.backward || "")}"></label><button>${icon("check", { size: 15 })} Salva collegamento</button></form></details>${attributeEditors({ definitions, entity: connection, entityType: "connection", entityId: id(connection._id) })}` : attributeSummary({ definitions, entity: connection, entityType: "connection" })}</article>`;
    }).join("");
    return `<section class="venue-command-block"><div class="section-heading compact"><div><h3>Collegamenti</h3><p>Gli estremi e la geometria si authorizzano sulla mappa; metrica e caratteristiche restano validate dal backend.</p></div><span class="count">${connections.length}</span></div>${this.renderConnectionComposer(editable)}<div class="venue-command-grid">${cards || `<div class="empty-state compact"><h4>Nessun collegamento</h4><p>Usa “Collega luoghi” sopra la mappa.</p></div>`}</div></section>`;
  },

  renderExhibitSlots(editable) {
    const layout = this.data.layout || {};
    const places = layout.places || [];
    const slots = layout.exhibitSlots || [];
    const targets = this.data.targets || [];
    const placeById = new Map(places.map((place) => [id(place._id), place]));
    const floorById = new Map((layout.floors || []).map((floor) => [id(floor._id), floor]));
    const targetById = new Map(targets.map((target) => [id(target.id), target]));
    const cards = slots.map((slot) => {
      const place = placeById.get(id(slot.placeId));
      const floor = floorById.get(id(place?.floorId));
      const assigned = targetById.get(id(slot.assignedVenueTargetId));
      const unassignedTargets = targets.filter((entry) => !entry.exhibitSlot || id(entry.id) === id(assigned?.id));
      const connectionOptions = (layout.connections || []).filter((connection) => id(connection.toPlaceId) === id(place?._id)).map((connection) => {
        const from = placeById.get(id(connection.fromPlaceId));
        return `<option value="${escapeHtml(id(connection._id))}">${escapeHtml(from?.label || "Luogo")} → ${escapeHtml(place?.label || "Luogo")}</option>`;
      }).join("");
      const sourceSlotOptions = slots.filter((entry) => id(entry.exhibitSlotId) !== id(slot.exhibitSlotId) && id(entry.placeId) === id(slot.placeId)).map((entry) => `<option value="${escapeHtml(id(entry.exhibitSlotId))}">${escapeHtml(entry.label)}</option>`).join("");
      return `<article class="venue-command-card exhibit-slot-card${id(this.selectedExhibitSlotId) === id(slot.exhibitSlotId) ? " selected locate-highlight" : ""}" data-exhibit-slot-card="${escapeHtml(id(slot.exhibitSlotId))}"><header><div><span class="eyebrow">ExhibitSlot</span><h3>${escapeHtml(slot.label)}</h3></div><span class="chip">${assigned ? "Assegnato" : "Libero"}</span></header><p>${escapeHtml(place?.label || "Place mancante")} · ${escapeHtml(floor?.label || "Piano")}</p><code class="slot-public-code">${escapeHtml(slot.publicCode || "Codice non disponibile")}</code><div class="button-row"><button class="button-secondary small" type="button" data-copy-slot-code="${escapeHtml(slot.publicCode || "")}" ${slot.publicCode ? "" : "disabled"}>Copia codice</button><button class="button-secondary small" type="button" data-locate-slot="${escapeHtml(id(slot.exhibitSlotId))}">Localizza</button></div>${editable ? `<form data-slot-assignment="${escapeHtml(id(slot.exhibitSlotId))}" class="venue-inline-form"><label>Entità esposta<select name="venueTargetId"><option value="">Nessuna entità</option>${unassignedTargets.map((target) => `<option value="${escapeHtml(id(target.id))}" ${selected(target.id, assigned?.id)}>${escapeHtml(target.label)}</option>`).join("")}</select></label><button>Salva assegnazione</button></form><details><summary>Dettagli e istruzioni di approccio</summary><form data-slot-editor="${escapeHtml(id(slot.exhibitSlotId))}" class="venue-inline-form"><label>Etichetta slot<input name="label" value="${escapeHtml(slot.label)}" required></label><label>Place<select name="placeId">${places.map((entry) => `<option value="${escapeHtml(id(entry._id))}" ${selected(entry._id, slot.placeId)}>${escapeHtml(entry.label || "Luogo")}</option>`).join("")}</select></label><label>Ordine<input name="order" type="number" min="0" value="${slot.order ?? ""}"></label><label class="wide">Istruzione predefinita<textarea name="defaultInstruction">${escapeHtml(slot.approachGuidance?.defaultInstruction || "")}</textarea></label><label>Da collegamento<select name="sourceConnectionId"><option value="">Nessun override</option>${connectionOptions}</select></label><label>Da slot vicino<select name="sourceExhibitSlotId"><option value="">Nessun override</option>${sourceSlotOptions}</select></label><label class="wide">Istruzione specifica<input name="overrideInstruction" placeholder="Es. L’opera è alla tua destra"></label><button>Salva slot</button></form><button class="danger small" type="button" data-remove-slot="${escapeHtml(id(slot.exhibitSlotId))}">Rimuovi slot</button></details>` : ""}</article>`;
    }).join("");
    const create = editable && places.length ? `<form data-create-slot class="venue-inline-create"><div class="venue-form-intro"><strong>Nuovo slot espositivo</strong><small>Definisci l’etichetta, poi scegli il Place direttamente sulla mappa.</small></div><label>Etichetta<input name="label" required placeholder="Es. Parete nord · Slot 1"></label><label>Ordine facoltativo<input name="order" type="number" min="0"></label><button>${icon("pin", { size: 15 })} Scegli Place</button></form>` : "";
    return `<section class="venue-arrangement-panel"><div class="section-heading compact"><div><h3>Slot espositivi</h3><p>Gli slot sono posizioni stabili; le entità possono essere assegnate o scollegate senza perdere disponibilità e media.</p></div><span class="count">${slots.length}</span></div>${create}<div class="venue-command-grid">${cards || `<div class="empty-state compact"><h4>Nessuno slot</h4><p>Crea il primo slot e associalo a un Place.</p></div>`}</div></section>`;
  },

  renderMapInspector(editable) {
    const layout = this.data.layout || {};
    const place = (layout.places || []).find((entry) => id(entry._id) === id(this.selectedMapPlaceId));
    if (!place) return `<aside class="venue-map-inspector empty"><span class="eyebrow">Inspector</span><h3>Seleziona un luogo</h3><p>Premi Invio o fai clic su un nodo. Trascinalo per salvarne la nuova posizione con un solo comando atomico.</p></aside>`;
    const floor = (layout.floors || []).find((entry) => id(entry._id) === id(place.floorId));
    const slots = (layout.exhibitSlots || []).filter((entry) => id(entry.placeId) === id(place._id));
    const type = this.physicalDefinitions().placeTypes.find((entry) => id(entry.definitionId) === id(place.placeTypeDefinitionId));
    return `<aside class="venue-map-inspector"><span class="eyebrow">Place inspector</span><h3>${escapeHtml(place.label || "Luogo senza nome")}</h3><p>${escapeHtml(type?.label || "Tipo non disponibile")} · ${escapeHtml(floor?.label || "Piano")}</p><dl class="venue-command-facts"><div><dt>Slot</dt><dd>${slots.length}</dd></div><div><dt>Posizione</dt><dd>${Number(place.position?.x || 0).toFixed(2)}, ${Number(place.position?.y || 0).toFixed(2)}</dd></div></dl>${slots.length ? `<ul class="venue-inspector-slots">${slots.map((slot) => `<li><button class="link-button" type="button" data-locate-slot="${escapeHtml(id(slot.exhibitSlotId))}">${escapeHtml(slot.label)}</button></li>`).join("")}</ul>` : `<p class="note">Nessuno slot in questo luogo.</p>`}${editable ? `<div class="button-row"><button type="button" data-show-spatial-tab="places">Modifica dettagli</button><button class="danger small" type="button" data-remove-place="${escapeHtml(id(place._id))}">Rimuovi</button></div>` : ""}</aside>`;
  },

  renderArrangement(editable) {
    const tabs = [["slots", "Slots"], ["entities", "Venue entities"]].map(([key, label]) => `<button type="button" data-arrangement-tab="${key}" aria-selected="${this.activeArrangementTab === key}">${label}</button>`).join("");
    return `<div class="venue-arrangement"><nav class="venue-arrangement-tabs" role="tablist" aria-label="Allestimento">${tabs}</nav>${this.activeArrangementTab === "entities" ? this.renderTargets(editable) : this.renderExhibitSlots(editable)}</div>`;
  },

  renderMapAndPlaces(editable) {
    if (!this.data.layout) return `<section class="venue-section" id="venue-map"><div class="empty-state"><h3>Nessun Layout disponibile</h3><p>Completa prima la configurazione iniziale della sede.</p></div></section>`;
    const vocabulary = this.data.physicalVocabulary;
    const spatialTabs = [["map", "Mappa"], ["places", "Luoghi"], ["connections", "Collegamenti"], ["arrangement", "Allestimento"]].map(([key, label]) => `<button type="button" role="tab" data-spatial-tab="${key}" aria-selected="${this.activeSpatialTab === key}">${label}</button>`).join("");
    const panel = this.activeSpatialTab === "places" ? `${this.renderFloors(editable)}${this.renderPlaces(editable)}`
      : this.activeSpatialTab === "connections" ? this.renderConnections(editable)
        : this.activeSpatialTab === "arrangement" ? this.renderArrangement(editable)
          : `<div class="venue-canvas-layout">${this.renderMapPreview(editable)}${this.renderMapInspector(editable)}</div>${this.renderActiveFloorMetadata?.(editable) || ""}${this.renderCalibrationComposer(editable)}${this.renderGeometryComposer(editable)}`;
    const vocabularyContext = vocabulary ? `<aside class="venue-vocabulary-context"><span><b>${escapeHtml(vocabulary.name)}</b><small>v${vocabulary.version} · ${escapeHtml(vocabulary.status)}</small></span>${vocabulary.canManage ? `<button class="button-secondary small" type="button" data-edit-physical-vocabulary="${escapeHtml(vocabulary.id)}">Gestisci vocabolario</button>` : ""}</aside>` : "";
    return `<section class="venue-section venue-spatial-section" id="venue-map"><header class="venue-spatial-header"><div><span class="eyebrow">Spazi e mappa</span><h2>Editor spaziale</h2></div>${vocabularyContext}</header>${this.renderSpatialIssues?.() || ""}<nav class="venue-spatial-tabs" role="tablist" aria-label="Strumenti dell’editor">${spatialTabs}</nav><div class="venue-spatial-workspace" role="tabpanel">${panel}</div></section>`;
  },
};
