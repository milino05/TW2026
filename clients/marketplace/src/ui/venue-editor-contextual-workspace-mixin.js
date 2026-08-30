import { icon } from "./icons.js";
import { venueMapCreationDialogMixin } from "./venue-editor-map-creation-dialog-mixin.js";

const SPATIAL_TABS = new Set(["map", "places", "connections", "slots", "inventory"]);
function id(value) { return String(value?._id || value?.id || value || ""); }
function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function metricLabel(connection) {
  if (connection.metricMode === "geometry_derived") return "Geometria calibrata";
  if (connection.metricMode === "length_constrained") return "Lunghezza vincolata";
  return "Distanza manuale";
}
function normalizedSpatialTab(value) { return SPATIAL_TABS.has(value) ? value : "map"; }
function ids(entries, selector) { return new Set((entries || []).map(selector).map(id).filter(Boolean)); }
function createdId(beforeIds, entries, selector) {
  return (entries || []).map(selector).map(id).find((entryId) => entryId && !beforeIds.has(entryId)) || null;
}

export const venueContextualWorkspaceMixin = {
  locateExhibitSlot(exhibitSlotId) {
    return this.openSpatialEditor?.("slot", exhibitSlotId) || false;
  },

  async handleMapAuthoringClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return false;

    const spatialTab = target.closest("[data-spatial-tab]");
    if (spatialTab) this.spatialEditor = null;

    if (this.pendingMapAction && target.closest("[data-map-connection]")) return true;

    const openPlace = target.closest("[data-open-spatial-place]");
    if (openPlace) return this.openSpatialEditor("place", openPlace.dataset.openSpatialPlace) || true;
    const openConnection = target.closest("[data-open-spatial-connection]");
    if (openConnection) return this.openSpatialEditor("connection", openConnection.dataset.openSpatialConnection) || true;
    const openSlot = target.closest("[data-open-spatial-slot]");
    if (openSlot) return this.openSpatialEditor("slot", openSlot.dataset.openSpatialSlot) || true;

    if (target.closest("[data-context-create-place]")) {
      const floor = this.activeFloor?.();
      this.spatialEditor = null;
      this.activeSpatialTab = "map";
      if (!floor) { this.render(); return true; }
      this.mapCreationDialog = { type: "place", floorId: id(floor._id) };
      this.render();
      requestAnimationFrame(() => this.querySelector("[data-map-place-dialog] input[name=label]")?.focus());
      return true;
    }

    if (target.closest("[data-context-start-connection]")) {
      this.spatialEditor = null;
      this.activeSpatialTab = "map";
      this.pendingMapAction = { type: "connect", fromPlaceId: null, toPlaceId: null };
      this.render();
      return true;
    }

    if (target.closest("[data-start-slot]")) {
      this.spatialEditor = null;
      this.activeSpatialTab = "map";
      this.mapCreationDialog = { type: "slot" };
      this.render();
      requestAnimationFrame(() => this.querySelector("[data-map-slot-dialog] input[name=label]")?.focus());
      return true;
    }

    const actionType = this.pendingMapAction?.type || null;
    const beforePlaces = ids(this.data.layout?.places, (entry) => entry._id);
    const beforeSlots = ids(this.data.layout?.exhibitSlots, (entry) => entry.exhibitSlotId);
    const handled = await venueMapCreationDialogMixin.handleMapAuthoringClick.call(this, event);
    if (!handled) return false;

    if (actionType === "create-place") {
      const placeId = createdId(beforePlaces, this.data.layout?.places, (entry) => entry._id);
      if (placeId) this.openSpatialEditor("place", placeId);
    } else if (actionType === "placing-slot") {
      const exhibitSlotId = createdId(beforeSlots, this.data.layout?.exhibitSlots, (entry) => entry.exhibitSlotId);
      if (exhibitSlotId) this.openSpatialEditor("slot", exhibitSlotId);
    }
    return true;
  },

  async handleMapAuthoringSubmit(form, data) {
    if (form.matches("[data-map-slot-dialog]")) {
      this.pendingMapAction = {
        type: "placing-slot",
        label: String(data.get("label") || "").trim(),
        order: String(data.get("order") || "").trim() ? Number(data.get("order")) : null,
      };
      this.mapCreationDialog = null;
      this.spatialEditor = null;
      this.activeSpatialTab = "map";
      this.render();
      return true;
    }

    const beforeFloors = ids(this.data.layout?.floors, (entry) => entry._id);
    const beforeConnections = ids(this.data.layout?.connections, (entry) => entry._id);
    const beforeSlots = ids(this.data.layout?.exhibitSlots, (entry) => entry.exhibitSlotId);
    const handled = await venueMapCreationDialogMixin.handleMapAuthoringSubmit.call(this, form, data);
    if (!handled) return false;

    const floorId = createdId(beforeFloors, this.data.layout?.floors, (entry) => entry._id);
    if (floorId) {
      this.selectedFloorId = floorId;
      this.spatialEditor = null;
      this.activeSpatialTab = "map";
      this.render();
      return true;
    }

    const connectionId = createdId(beforeConnections, this.data.layout?.connections, (entry) => entry._id);
    if (connectionId) {
      this.openSpatialEditor("connection", connectionId);
      return true;
    }

    const exhibitSlotId = createdId(beforeSlots, this.data.layout?.exhibitSlots, (entry) => entry.exhibitSlotId);
    if (exhibitSlotId) this.openSpatialEditor("slot", exhibitSlotId);
    return true;
  },

  renderMapCreationDialog(editable) {
    if (editable && this.mapCreationDialog?.type === "slot") {
      return `<div class="venue-modal-backdrop" role="presentation"><section class="venue-modal-card" role="dialog" aria-modal="true" aria-labelledby="venue-slot-create-title"><header><div><span class="eyebrow">Nuovo slot espositivo</span><h3 id="venue-slot-create-title">Definisci lo slot prima di scegliere il luogo</h3></div><button class="button-secondary small" type="button" data-close-map-creation-dialog aria-label="Chiudi">×</button></header><p>Lo slot rappresenta una posizione espositiva stabile. Dopo questi dati selezionerai sulla mappa il Place che lo contiene.</p><form data-map-slot-dialog class="venue-inline-form"><label>Etichetta<input name="label" required placeholder="Es. Parete destra · posizione 2"></label><label>Ordine facoltativo<input name="order" type="number" min="0"></label><div class="button-row"><button type="submit">Scegli luogo sulla mappa</button><button class="button-secondary" type="button" data-close-map-creation-dialog>Annulla</button></div></form></section></div>`;
    }
    return venueMapCreationDialogMixin.renderMapCreationDialog.call(this, editable);
  },

  renderPlaces(editable) {
    const layout = this.data.layout || {};
    const floors = layout.floors || [];
    const places = layout.places || [];
    const definitions = this.physicalDefinitions();
    const floorById = new Map(floors.map((floor) => [id(floor._id), floor]));
    const typeById = new Map((definitions.placeTypes || []).map((type) => [id(type.definitionId), type]));
    const slotCountByPlace = new Map();
    const connectionCountByPlace = new Map();
    for (const slot of layout.exhibitSlots || []) slotCountByPlace.set(id(slot.placeId), (slotCountByPlace.get(id(slot.placeId)) || 0) + 1);
    for (const connection of layout.connections || []) {
      connectionCountByPlace.set(id(connection.fromPlaceId), (connectionCountByPlace.get(id(connection.fromPlaceId)) || 0) + 1);
      connectionCountByPlace.set(id(connection.toPlaceId), (connectionCountByPlace.get(id(connection.toPlaceId)) || 0) + 1);
    }
    const cards = places.map((place) => {
      const placeId = id(place._id);
      const active = this.spatialEditor?.kind === "place" && id(this.spatialEditor.id) === placeId;
      return `<article class="venue-command-card${active ? " selected" : ""}"><header><div><span class="eyebrow">${escapeHtml(typeById.get(id(place.placeTypeDefinitionId))?.label || "Tipo non disponibile")}</span><h3>${escapeHtml(place.label || "Luogo senza nome")}</h3></div><span class="chip">${escapeHtml(floorById.get(id(place.floorId))?.label || "Piano")}</span></header><dl class="venue-command-facts"><div><dt>Slot espositivi</dt><dd>${slotCountByPlace.get(placeId) || 0}</dd></div><div><dt>Collegamenti</dt><dd>${connectionCountByPlace.get(placeId) || 0}</dd></div></dl><div class="button-row"><button class="button-secondary small" type="button" data-open-spatial-place="${escapeHtml(placeId)}">Gestisci</button></div></article>`;
    }).join("");
    const create = editable && floors.length && definitions.placeTypes?.length ? `<button type="button" data-context-create-place>${icon("plus", { size: 15 })} Nuovo luogo</button>` : "";
    return `<section class="venue-command-block"><div class="section-heading compact"><div><h3>Luoghi</h3><p>Vista globale dei nodi del grafo fisico. Seleziona un luogo per aprire il suo editor dettagliato.</p></div><div class="button-row"><span class="count">${places.length}</span>${create}</div></div><div class="venue-command-grid">${cards || `<div class="empty-state compact"><h4>Nessun luogo</h4><p>Apri la mappa e crea il primo Place.</p></div>`}</div></section>`;
  },

  renderConnections(editable) {
    const layout = this.data.layout || {};
    const places = layout.places || [];
    const connections = layout.connections || [];
    const definitions = this.physicalDefinitions();
    const placeById = new Map(places.map((place) => [id(place._id), place]));
    const floorById = new Map((layout.floors || []).map((floor) => [id(floor._id), floor]));
    const typeById = new Map((definitions.connectionTypes || []).map((type) => [id(type.definitionId), type]));
    const cards = connections.map((connection) => {
      const from = placeById.get(id(connection.fromPlaceId));
      const to = placeById.get(id(connection.toPlaceId));
      const sameFloor = from && to && id(from.floorId) === id(to.floorId);
      const location = sameFloor ? floorById.get(id(from?.floorId))?.label || "Piano" : `${floorById.get(id(from?.floorId))?.label || "Piano"} ↕ ${floorById.get(id(to?.floorId))?.label || "Piano"}`;
      const instructionCount = Number(Boolean(connection.instructions?.forward)) + Number(Boolean(connection.instructions?.backward));
      const active = this.spatialEditor?.kind === "connection" && id(this.spatialEditor.id) === id(connection._id);
      return `<article class="venue-command-card${active ? " selected" : ""}"><header><div><span class="eyebrow">${escapeHtml(typeById.get(id(connection.connectionTypeDefinitionId))?.label || "Collegamento")}</span><h3>${escapeHtml(from?.label || "?")} → ${escapeHtml(to?.label || "?")}</h3></div><span class="chip">${escapeHtml(location)}</span></header><p>${escapeHtml(metricLabel(connection))} · ${Number(connection.distanceMeters || 0).toFixed(1)} m · ${connection.directionality === "directed" ? "una direzione" : "bidirezionale"}</p><dl class="venue-command-facts"><div><dt>Istruzioni</dt><dd>${instructionCount ? `${instructionCount} configurate` : "Da completare"}</dd></div><div><dt>Geometria</dt><dd>${connection.geometry?.points?.length > 2 ? "Dettagliata" : "Diretta"}</dd></div></dl><div class="button-row"><button class="button-secondary small" type="button" data-open-spatial-connection="${escapeHtml(id(connection._id))}">Gestisci</button></div></article>`;
    }).join("");
    const create = editable && places.length >= 2 ? `<button type="button" data-context-start-connection>${icon("link", { size: 15 })} Nuovo collegamento</button>` : "";
    return `<section class="venue-command-block"><div class="section-heading compact"><div><h3>Collegamenti</h3><p>Vista globale degli archi del grafo. Seleziona un collegamento per indicazioni, percorso e caratteristiche.</p></div><div class="button-row"><span class="count">${connections.length}</span>${create}</div></div><div class="venue-command-grid">${cards || `<div class="empty-state compact"><h4>Nessun collegamento</h4><p>Apri la mappa e collega due luoghi.</p></div>`}</div></section>`;
  },

  renderExhibitSlots(editable) {
    const layout = this.data.layout || {};
    const slots = layout.exhibitSlots || [];
    const targets = this.data.targets || [];
    const placeById = new Map((layout.places || []).map((place) => [id(place._id), place]));
    const floorById = new Map((layout.floors || []).map((floor) => [id(floor._id), floor]));
    const targetById = new Map(targets.map((target) => [id(target.id), target]));
    const cards = slots.map((slot) => {
      const slotId = id(slot.exhibitSlotId);
      const place = placeById.get(id(slot.placeId));
      const floor = floorById.get(id(place?.floorId));
      const assigned = targetById.get(id(slot.assignedVenueTargetId)) || targets.find((target) => id(target.exhibitSlot?.id || target.exhibitSlot?._id) === slotId);
      const active = this.spatialEditor?.kind === "slot" && id(this.spatialEditor.id) === slotId;
      return `<article class="venue-command-card exhibit-slot-card${active ? " selected locate-highlight" : ""}"><header><div><span class="eyebrow">Slot espositivo</span><h3>${escapeHtml(slot.label)}</h3></div><span class="chip">${assigned ? "Assegnato" : "Libero"}</span></header><p>${escapeHtml(place?.label || "Luogo mancante")} · ${escapeHtml(floor?.label || "Piano")}</p><dl class="venue-command-facts"><div><dt>Entità esposta</dt><dd>${escapeHtml(assigned?.label || "Nessuna")}</dd></div><div><dt>Indicazione</dt><dd>${escapeHtml(slot.approachGuidance?.defaultInstruction || "Da completare")}</dd></div></dl><code class="slot-public-code">${escapeHtml(slot.publicCode || "Codice non disponibile")}</code><div class="button-row"><button class="button-secondary small" type="button" data-open-spatial-slot="${escapeHtml(slotId)}">Gestisci</button>${slot.publicCode ? `<button class="button-secondary small" type="button" data-copy-slot-code="${escapeHtml(slot.publicCode)}">Copia codice</button>` : ""}</div></article>`;
    }).join("");
    const create = editable && (layout.places || []).length ? `<button type="button" data-start-slot>${icon("pin", { size: 15 })} Nuovo slot</button>` : "";
    return `<section class="venue-command-block"><div class="section-heading compact"><div><h3>Slot espositivi</h3><p>Posizioni stabili dell’allestimento. Ogni slot ha un editor dedicato per entità, indicazioni e proprietà avanzate.</p></div><div class="button-row"><span class="count">${slots.length}</span>${create}</div></div><div class="venue-command-grid">${cards || `<div class="empty-state compact"><h4>Nessuno slot</h4><p>Crea uno slot dalla toolbar della mappa o dall’editor di un luogo.</p></div>`}</div></section>`;
  },

  renderMapAndPlaces(editable) {
    if (!this.data.layout) return `<section class="venue-section" id="venue-map"><div class="empty-state"><h3>Nessun Layout disponibile</h3><p>Completa prima la configurazione iniziale della sede.</p></div></section>`;
    const activeTab = normalizedSpatialTab(this.activeSpatialTab);
    this.activeSpatialTab = activeTab;
    const vocabulary = this.data.physicalVocabulary;
    const tabs = [["map", "Mappa"], ["places", "Luoghi"], ["connections", "Collegamenti"], ["slots", "Slot espositivi"], ["inventory", "Inventario"]];
    const spatialTabs = tabs.map(([key, label]) => `<button type="button" id="venue-spatial-tab-${key}" role="tab" data-spatial-tab="${key}" aria-controls="venue-spatial-panel-${key}" aria-selected="${activeTab === key}">${label}</button>`).join("");
    const mapPanel = this.spatialEditor
      ? this.renderSpatialEditor(editable)
      : `<div class="venue-canvas-layout venue-canvas-layout--full">${this.renderMapPreview(editable)}</div>${this.renderCalibrationComposer(editable)}${this.renderGeometryComposer(editable)}`;
    const panel = activeTab === "places" ? this.renderPlaces(editable)
      : activeTab === "connections" ? this.renderConnections(editable)
        : activeTab === "slots" ? this.renderExhibitSlots(editable)
          : activeTab === "inventory" ? this.renderTargets(editable)
            : mapPanel;
    const vocabularyContext = vocabulary ? `<div class="venue-vocabulary-context" aria-label="Vocabolario fisico in uso"><span><strong>${escapeHtml(vocabulary.name)}</strong><small>v${vocabulary.version} · ${escapeHtml(vocabulary.status)}</small></span>${vocabulary.canManage ? `<button class="button-secondary small" type="button" data-edit-physical-vocabulary="${escapeHtml(vocabulary.id)}">Gestisci vocabolario</button>` : ""}</div>` : "";
    const section = `<section class="venue-section venue-spatial-section" id="venue-map"><header class="venue-spatial-header"><div><span class="eyebrow">Spazi e mappa</span><h2>Editor spaziale</h2></div>${vocabularyContext}</header>${this.renderSpatialIssues?.() || ""}<nav class="venue-spatial-tabs" role="tablist" aria-label="Strumenti dell’editor">${spatialTabs}</nav><div class="venue-spatial-workspace" id="venue-spatial-panel-${escapeHtml(activeTab)}" role="tabpanel" aria-labelledby="venue-spatial-tab-${escapeHtml(activeTab)}">${panel}</div></section>`;
    return `${section}${this.renderFloorDialog?.(editable) || ""}${this.renderMapCreationDialog(editable)}`;
  },
};
