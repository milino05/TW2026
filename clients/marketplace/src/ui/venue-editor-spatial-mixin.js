import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function selected(value, current) { return String(value ?? "") === String(current ?? "") ? "selected" : ""; }
function id(value) { return String(value?._id || value?.id || value || ""); }
function pct(value) { return Math.max(0, Math.min(100, Number(value ?? .5) * 100)); }

export const venueSpatialMixin = {
  physicalDefinitions() {
    return this.data.physicalVocabulary?.definitions || { placeTypes: [], connectionTypes: [], physicalAttributes: [], routingProfiles: [] };
  },

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
    if (action.type === "connect") {
      const count = Number(Boolean(action.fromPlaceId)) + Number(Boolean(action.toPlaceId));
      return `<p class="venue-map-instruction active"><strong>Collega luoghi</strong> · ${count === 0 ? "seleziona il primo luogo" : count === 1 ? "ora seleziona il secondo luogo, anche su un altro piano" : "completa la configurazione del collegamento"}.</p>`;
    }
    if (action.type === "calibrate") return `<p class="venue-map-instruction active"><strong>Calibra planimetria</strong> · ${(action.points || []).length === 0 ? "seleziona il primo estremo di una distanza nota" : (action.points || []).length === 1 ? "seleziona il secondo estremo" : "inserisci la distanza reale nel pannello"}.</p>`;
    if (action.type === "geometry") return `<p class="venue-map-instruction active"><strong>Disegna il percorso</strong> · ogni clic aggiunge un punto intermedio; ingresso e uscita restano agganciati ai Place.</p>`;
    return "";
  },

  renderMapPreview(editable) {
    const layout = this.data.layout;
    const floors = layout?.floors || [];
    const places = layout?.places || [];
    const connections = layout?.connections || [];
    const floor = this.activeFloor();
    const floorId = id(floor?._id);
    const hasFloor = Boolean(floor);
    const floorPlaces = hasFloor ? places.filter((place) => id(place.floorId) === floorId) : [];
    const byId = new Map(floorPlaces.map((place) => [id(place._id), place]));
    const slotCountByPlace = new Map();
    for (const slot of layout?.exhibitSlots || []) {
      const placeId = id(slot.placeId);
      slotCountByPlace.set(placeId, (slotCountByPlace.get(placeId) || 0) + 1);
    }
    const floorOptions = floors.length
      ? floors.map((entry) => `<option value="${escapeHtml(id(entry._id))}" ${selected(id(entry._id), floorId)}>${escapeHtml(entry.label)}</option>`).join("")
      : `<option value="">Nessun piano disponibile</option>`;
    const floorControls = `<div class="venue-map-toolbar venue-floor-toolbar"><label class="venue-floor-picker"><span>Piano</span><select data-floor-select ${hasFloor ? "" : "disabled"}>${floorOptions}</select></label>${editable ? `<button class="button-secondary" type="button" data-add-floor-shortcut>${icon("plus", { size: 15 })} Aggiungi piano</button><button class="button-secondary" type="button" data-floor-settings-shortcut ${hasFloor ? "" : "disabled"}>${icon("edit", { size: 15 })} Impostazioni</button>` : ""}</div>`;
    const slotCount = hasFloor
      ? (layout?.exhibitSlots || []).filter((entry) => id(entry.placeId) && floorPlaces.some((place) => id(place._id) === id(entry.placeId))).length
      : 0;
    const heading = `<div class="venue-map-heading"><div>${floorControls}<small>La mappa descrive la sede; non traccia la posizione del visitatore.</small></div><span class="count">${floorPlaces.length} luoghi · ${slotCount} slot</span></div>`;

    if (!hasFloor) {
      return `<div class="venue-map-preview">${heading}<div class="empty-state compact"><h3>Nessun piano configurato</h3><p>Usa “Aggiungi piano” accanto al selettore per creare il primo piano della sede.</p></div></div>`;
    }

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
      const slotCountForPlace = slotCountByPlace.get(id(place._id)) || 0;
      const label = `${place.label || `Luogo ${index + 1}`}${slotCountForPlace ? `, ${slotCountForPlace} slot` : ""}`;
      return `<button class="map-place-node${selectedPlace ? " selected" : ""}${endpoint ? " endpoint" : ""}" type="button" data-map-place="${escapeHtml(id(place._id))}" style="left:${pct(place.position?.x)}%;top:${pct(place.position?.y)}%" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><span>${index + 1}</span>${slotCountForPlace ? `<small>${slotCountForPlace}</small>` : ""}</button>`;
    }).join("");
    const ratio = floor?.mapAsset?.width && floor?.mapAsset?.height ? `${floor.mapAsset.width}/${floor.mapAsset.height}` : "10/7";
    const mode = this.mapMode?.() || "idle";
    const toolbar = editable ? `<div class="venue-map-toolbar"><button class="button-secondary" type="button" data-show-spatial-tab="places">${icon("plus", { size: 15 })} Nuovo luogo</button><button class="button-secondary" type="button" data-map-tool="connect" aria-pressed="${mode.startsWith("connecting_")}" ${places.length < 2 ? "disabled" : ""}>${icon("link", { size: 15 })} Collega</button><button class="button-secondary" type="button" data-map-tool="calibrate" aria-pressed="${mode === "calibrating"}" ${floor?.mapAsset ? "" : "disabled"}>${icon("ruler", { size: 15 })} Calibra</button>${this.pendingMapAction ? `<button class="button-secondary" type="button" data-cancel-map-action>Annulla · Esc</button>` : ""}</div>` : "";
    return `<div class="venue-map-preview">${heading}${toolbar}${this.renderMapActionStatus()}<div class="map-canvas map-canvas--authoring" data-map-surface data-floor-id="${escapeHtml(floorId)}" style="--map-ratio:${ratio}">${floor.mapAsset?.url ? `<img src="${escapeHtml(floor.mapAsset.url)}" alt="Planimetria ${escapeHtml(floor.label)}" draggable="false">` : `<div class="map-canvas-placeholder"><strong>Nessuna planimetria</strong><span>Apri Impostazioni per caricare la planimetria; la griglia resta utilizzabile per impostare la struttura logica.</span></div>`}<svg viewBox="0 0 100 100" preserveAspectRatio="none">${lines}${geometryOverlay}${calibrationOverlay}</svg>${nodes}</div></div>`;
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
};