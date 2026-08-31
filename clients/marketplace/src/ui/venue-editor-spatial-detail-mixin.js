import { managementRepository } from "../infrastructure/http/management-repository.js";
import { venueMapAuthoringMixin } from "./venue-editor-map-authoring-mixin.js";

function id(value) { return String(value?._id || value?.id || value || ""); }
function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function selected(value, current) { return id(value) === id(current) ? "selected" : ""; }
function valueForAttribute(entity, definitionId) {
  return (entity?.attributeValues || []).find((entry) => id(entry.physicalAttributeDefinitionId) === id(definitionId))?.value;
}
function attributeInput(definition, current) {
  if (definition.dataType === "boolean") return `<select name="value"><option value="" ${current === undefined || current === null ? "selected" : ""}>Non verificato</option><option value="true" ${current === true ? "selected" : ""}>Sì</option><option value="false" ${current === false ? "selected" : ""}>No</option></select>`;
  if (definition.dataType === "choice") return `<select name="value"><option value="">Non verificato</option>${(definition.options || []).map((option) => `<option value="${escapeHtml(option.value)}" ${selected(option.value, current)}>${escapeHtml(option.label)}</option>`).join("")}</select>`;
  if (definition.dataType === "number") return `<input name="value" type="number" step="any" value="${current === undefined || current === null ? "" : escapeHtml(current)}" placeholder="Non verificato">`;
  return `<input name="value" value="${current === undefined || current === null ? "" : escapeHtml(current)}" placeholder="Non verificato">`;
}
function attributeEditorList(definitions, entity, entityType, entityId) {
  const applicable = (definitions.physicalAttributes || []).filter((definition) => [entityType, "both"].includes(definition.appliesTo));
  if (!applicable.length) return `<div class="empty-state compact"><h3>Nessuna caratteristica configurata</h3><p>Il PhysicalVocabulary corrente non definisce attributi per questo tipo di elemento.</p></div>`;
  return `<div class="venue-detail-attribute-list">${applicable.map((definition) => {
    const current = valueForAttribute(entity, definition.definitionId);
    return `<form data-physical-attribute data-entity-type="${escapeHtml(entityType)}" data-entity-id="${escapeHtml(entityId)}" data-definition-id="${escapeHtml(definition.definitionId)}" data-data-type="${escapeHtml(definition.dataType)}" class="venue-detail-attribute"><label><span>${escapeHtml(definition.label)}</span><small>${escapeHtml(definition.description || (definition.unit ? `Unità: ${definition.unit}` : "Valore fisico usato dal routing"))}</small>${attributeInput(definition, current)}</label><button class="button-secondary" type="submit">Salva</button></form>`;
  }).join("")}</div>`;
}
function assignedTargetForSlot(targets, slotId) {
  return (targets || []).find((target) => id(target.exhibitSlot?.id || target.exhibitSlot?._id) === id(slotId));
}
function incomingConnections(layout, placeId) {
  return (layout.connections || []).filter((connection) => (
    id(connection.toPlaceId) === id(placeId)
    || (connection.directionality === "bidirectional" && id(connection.fromPlaceId) === id(placeId))
  ));
}
function targetAssignmentLabel(target, assignedTargetId) {
  if (id(target.id) === id(assignedTargetId)) return target.label;
  if (target.exhibitSlot?.label) return `${target.label} — ricolloca da ${target.exhibitSlot.label}`;
  if (target.configuration?.state === "unavailable") return `${target.label} — non disponibile`;
  return target.label;
}
function hidden(name, value) { return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value ?? "")}">`; }
function detailTabs(entries, activeTab) {
  return `<nav class="venue-spatial-detail-tabs" role="tablist">${entries.map(([key, label, count]) => `<button type="button" role="tab" data-spatial-editor-tab="${escapeHtml(key)}" aria-selected="${activeTab === key}">${escapeHtml(label)}${Number.isFinite(count) ? ` <span class="count">${count}</span>` : ""}</button>`).join("")}</nav>`;
}
function detailShell({ eyebrow, title, subtitle, tabs, activeTab, panel, danger = "", breadcrumb = "" }) {
  return `<section class="venue-spatial-detail"><div class="venue-spatial-detail-topbar"><button class="button-secondary" type="button" data-close-spatial-editor>← Torna alla mappa</button>${breadcrumb}</div><header class="venue-spatial-detail-header"><div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h2>${escapeHtml(title)}</h2><p>${subtitle}</p></div></header>${detailTabs(tabs, activeTab)}<div class="venue-spatial-detail-panel">${panel}</div>${danger}</section>`;
}

export const venueSpatialDetailMixin = {
  openSpatialEditor(kind, entityId, { tab = null } = {}) {
    const layout = this.data.layout || {};
    const entityKey = id(entityId);
    if (kind === "place") {
      const place = (layout.places || []).find((entry) => id(entry._id) === entityKey);
      if (!place) return false;
      this.selectedMapPlaceId = entityKey;
      this.selectedConnectionId = null;
      this.selectedExhibitSlotId = null;
      this.selectedFloorId = id(place.floorId);
      this.spatialEditor = { kind, id: entityKey, tab: tab || "general" };
    } else if (kind === "connection") {
      const connection = (layout.connections || []).find((entry) => id(entry._id) === entityKey);
      if (!connection) return false;
      const from = (layout.places || []).find((entry) => id(entry._id) === id(connection.fromPlaceId));
      this.selectedConnectionId = entityKey;
      this.selectedMapPlaceId = null;
      this.selectedExhibitSlotId = null;
      if (from?.floorId) this.selectedFloorId = id(from.floorId);
      this.spatialEditor = { kind, id: entityKey, tab: tab || "general" };
    } else if (kind === "slot") {
      const slot = (layout.exhibitSlots || []).find((entry) => id(entry.exhibitSlotId) === entityKey);
      const place = (layout.places || []).find((entry) => id(entry._id) === id(slot?.placeId));
      if (!slot || !place) return false;
      this.selectedExhibitSlotId = entityKey;
      this.selectedMapPlaceId = id(place._id);
      this.selectedConnectionId = null;
      this.selectedFloorId = id(place.floorId);
      this.spatialEditor = { kind, id: entityKey, parentPlaceId: id(place._id), tab: tab || "entity" };
    } else return false;
    this.activeSpatialTab = "map";
    this.render();
    requestAnimationFrame(() => this.querySelector(".venue-spatial-detail input, .venue-spatial-detail select, .venue-spatial-detail textarea, .venue-spatial-detail button")?.focus());
    return true;
  },

  closeSpatialEditor() {
    this.spatialEditor = null;
    this.activeSpatialTab = "map";
    this.render();
    requestAnimationFrame(() => {
      const focused = this.selectedMapPlaceId
        ? this.querySelector(`[data-map-place="${CSS.escape(id(this.selectedMapPlaceId))}"]`)
        : this.selectedConnectionId
          ? this.querySelector(`[data-map-connection="${CSS.escape(id(this.selectedConnectionId))}"]`)
          : null;
      focused?.focus?.();
    });
  },

  async handleMapAuthoringClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return false;

    const detailTab = target.closest("[data-spatial-editor-tab]");
    if (detailTab && this.spatialEditor) {
      this.spatialEditor = { ...this.spatialEditor, tab: detailTab.dataset.spatialEditorTab };
      this.render();
      return true;
    }
    if (target.closest("[data-close-spatial-editor]")) {
      this.closeSpatialEditor();
      return true;
    }
    const openPlace = target.closest("[data-open-spatial-place]");
    if (openPlace) return this.openSpatialEditor("place", openPlace.dataset.openSpatialPlace) || true;
    const openConnection = target.closest("[data-open-spatial-connection]");
    if (openConnection) return this.openSpatialEditor("connection", openConnection.dataset.openSpatialConnection) || true;
    const openSlot = target.closest("[data-open-spatial-slot]");
    if (openSlot) return this.openSpatialEditor("slot", openSlot.dataset.openSpatialSlot) || true;

    if (target.closest("[data-position-place], [data-edit-connection-geometry]")) {
      this.spatialEditor = null;
      this.activeSpatialTab = "map";
      return venueMapAuthoringMixin.handleMapAuthoringClick.call(this, event);
    }

    const mapConnection = target.closest("[data-map-connection]");
    if (mapConnection && !this.pendingMapAction) {
      this.openSpatialEditor("connection", mapConnection.dataset.mapConnection);
      return true;
    }
    const mapPlace = target.closest("[data-map-place]");
    if (mapPlace && !this.pendingMapAction) {
      this.openSpatialEditor("place", mapPlace.dataset.mapPlace);
      return true;
    }

    return venueMapAuthoringMixin.handleMapAuthoringClick.call(this, event);
  },

  async handleMapAuthoringSubmit(form, data) {
    if (form.matches("[data-detail-create-slot]")) {
      const placeId = form.dataset.detailCreateSlot;
      const before = new Set((this.data.layout?.exhibitSlots || []).map((slot) => id(slot.exhibitSlotId)));
      const label = String(data.get("label") || "").trim();
      const orderText = String(data.get("order") || "").trim();
      const success = await this.execute(
        () => managementRepository.createExhibitSlot(this.id, { placeId, label, order: orderText ? Number(orderText) : null }),
        "Slot espositivo creato nel luogo selezionato.",
      );
      if (success) {
        const created = (this.data.layout?.exhibitSlots || []).find((slot) => !before.has(id(slot.exhibitSlotId)));
        if (created) this.openSpatialEditor("slot", created.exhibitSlotId);
        else this.openSpatialEditor("place", placeId, { tab: "slots" });
      }
      return true;
    }

    if (form.matches("[data-length-constraint-authoring]")) {
      this.spatialEditor = null;
      this.activeSpatialTab = "map";
    }
    return venueMapAuthoringMixin.handleMapAuthoringSubmit.call(this, form, data);
  },

  renderSpatialEditor(editable) {
    const editor = this.spatialEditor;
    if (!editor) return "";
    if (editor.kind === "place") return this.renderPlaceSpatialEditor(editable, editor);
    if (editor.kind === "connection") return this.renderConnectionSpatialEditor(editable, editor);
    if (editor.kind === "slot") return this.renderSlotSpatialEditor(editable, editor);
    return "";
  },

  renderPlaceSpatialEditor(editable, editor) {
    const layout = this.data.layout || {};
    const definitions = this.physicalDefinitions();
    const place = (layout.places || []).find((entry) => id(entry._id) === id(editor.id));
    if (!place) return `<div class="empty-state"><h3>Luogo non disponibile</h3><button type="button" data-close-spatial-editor>Torna alla mappa</button></div>`;
    const floor = (layout.floors || []).find((entry) => id(entry._id) === id(place.floorId));
    const type = definitions.placeTypes.find((entry) => id(entry.definitionId) === id(place.placeTypeDefinitionId));
    const slots = (layout.exhibitSlots || []).filter((entry) => id(entry.placeId) === id(place._id));
    const targets = this.data.targets || [];
    const activeTab = ["general", "attributes", "slots"].includes(editor.tab) ? editor.tab : "general";
    let panel = "";
    if (activeTab === "general") {
      panel = editable
        ? `<div class="venue-detail-grid"><form data-place-editor="${escapeHtml(id(place._id))}" class="venue-inline-form venue-detail-form"><label>Nome<input name="label" value="${escapeHtml(place.label || "")}" required></label><label>Tipo<select name="placeTypeDefinitionId">${definitions.placeTypes.map((entry) => `<option value="${escapeHtml(entry.definitionId)}" ${selected(entry.definitionId, place.placeTypeDefinitionId)}>${escapeHtml(entry.label)}</option>`).join("")}</select></label><button type="submit">Salva dettagli</button></form><aside class="venue-detail-summary"><dl class="venue-command-facts"><div><dt>Piano</dt><dd>${escapeHtml(floor?.label || "Piano")}</dd></div><div><dt>Tipo</dt><dd>${escapeHtml(type?.label || "Non disponibile")}</dd></div><div><dt>Posizione</dt><dd>${Number(place.position?.x || 0).toFixed(2)}, ${Number(place.position?.y || 0).toFixed(2)}</dd></div><div><dt>Slot</dt><dd>${slots.length}</dd></div></dl><button class="button-secondary" type="button" data-position-place="${escapeHtml(id(place._id))}">Riposiziona sulla mappa</button></aside></div>`
        : `<dl class="venue-command-facts"><div><dt>Piano</dt><dd>${escapeHtml(floor?.label || "Piano")}</dd></div><div><dt>Tipo</dt><dd>${escapeHtml(type?.label || "Non disponibile")}</dd></div></dl>`;
    } else if (activeTab === "attributes") {
      panel = editable ? attributeEditorList(definitions, place, "place", id(place._id)) : `<p class="note">Le caratteristiche fisiche sono disponibili in modifica nella bozza di lavoro.</p>`;
    } else {
      const cards = slots.map((slot) => {
        const assigned = assignedTargetForSlot(targets, slot.exhibitSlotId);
        return `<article class="venue-detail-list-card"><div><span class="eyebrow">Slot espositivo</span><h3>${escapeHtml(slot.label)}</h3><p>${escapeHtml(assigned?.label || "Slot libero")} · ${escapeHtml(slot.approachGuidance?.defaultInstruction || "Nessuna indicazione predefinita")}</p></div><button class="button-secondary" type="button" data-open-spatial-slot="${escapeHtml(id(slot.exhibitSlotId))}">Gestisci</button></article>`;
      }).join("");
      panel = `<div class="venue-detail-list">${cards || `<div class="empty-state compact"><h3>Nessuno slot</h3><p>Questo luogo non contiene ancora posizioni espositive.</p></div>`}</div>${editable ? `<form data-detail-create-slot="${escapeHtml(id(place._id))}" class="venue-inline-form venue-detail-create"><strong>Nuovo slot in ${escapeHtml(place.label || "questo luogo")}</strong><label>Etichetta<input name="label" required placeholder="Es. Parete destra · posizione 2"></label><label>Ordine facoltativo<input name="order" type="number" min="0"></label><button type="submit">Crea e configura slot</button></form>` : ""}`;
    }
    const danger = editable ? `<section class="venue-detail-danger"><div><strong>Rimuovi luogo</strong><p>L’impatto su collegamenti e slot verrà mostrato prima della conferma.</p></div><button class="danger" type="button" data-remove-place="${escapeHtml(id(place._id))}" data-label="${escapeHtml(place.label || "questo luogo")}">Rimuovi luogo</button></section>` : "";
    return detailShell({ eyebrow: "Luogo", title: place.label || "Luogo senza nome", subtitle: `${escapeHtml(floor?.label || "Piano")} · ${escapeHtml(type?.label || "Tipo non disponibile")}`, tabs: [["general", "Generale"], ["attributes", "Caratteristiche"], ["slots", "Slot espositivi", slots.length]], activeTab, panel, danger });
  },

  renderConnectionSpatialEditor(editable, editor) {
    const layout = this.data.layout || {};
    const definitions = this.physicalDefinitions();
    const connection = (layout.connections || []).find((entry) => id(entry._id) === id(editor.id));
    if (!connection) return `<div class="empty-state"><h3>Collegamento non disponibile</h3><button type="button" data-close-spatial-editor>Torna alla mappa</button></div>`;
    const placesById = new Map((layout.places || []).map((entry) => [id(entry._id), entry]));
    const floorsById = new Map((layout.floors || []).map((entry) => [id(entry._id), entry]));
    const from = placesById.get(id(connection.fromPlaceId));
    const to = placesById.get(id(connection.toPlaceId));
    const sameFloor = from && to && id(from.floorId) === id(to.floorId);
    const floor = sameFloor ? floorsById.get(id(from.floorId)) : null;
    const calibrated = Boolean(floor?.calibration);
    const metricOptions = calibrated
      ? `<option value="manual_override" ${selected("manual_override", connection.metricMode)}>Distanza manuale</option><option value="geometry_derived" ${selected("geometry_derived", connection.metricMode)}>Dalla geometria calibrata</option>${connection.metricMode === "length_constrained" ? `<option value="length_constrained" selected>Lunghezza vincolata</option>` : ""}`
      : `<option value="manual_override" ${selected("manual_override", connection.metricMode)}>Distanza manuale</option>${connection.metricMode === "length_constrained" ? `<option value="length_constrained" selected>Lunghezza vincolata</option>` : ""}`;
    const activeTab = ["general", "instructions", "route", "attributes"].includes(editor.tab) ? editor.tab : "general";
    let panel = "";
    if (activeTab === "general") {
      panel = editable ? `<form data-connection-editor="${escapeHtml(id(connection._id))}" class="venue-inline-form venue-detail-form venue-detail-form--two-columns"><label>Tipo<select name="connectionTypeDefinitionId"><option value="">Senza tipo specifico</option>${definitions.connectionTypes.map((type) => `<option value="${escapeHtml(type.definitionId)}" ${selected(type.definitionId, connection.connectionTypeDefinitionId)}>${escapeHtml(type.label)}</option>`).join("")}</select></label><label>Direzione<select name="directionality"><option value="bidirectional" ${selected("bidirectional", connection.directionality)}>Entrambe le direzioni</option><option value="directed" ${selected("directed", connection.directionality)}>Solo da → a</option></select></label><label>Misurazione<select name="metricMode">${metricOptions}</select></label><label>Distanza (m)<input name="distanceMeters" type="number" min="0.1" step="0.1" value="${escapeHtml(connection.distanceMeters || "")}" ${connection.metricMode === "geometry_derived" ? "readonly" : ""}></label><label>Ritardo aggiuntivo (s)<input name="additionalDelaySeconds" type="number" min="0" step="1" value="${escapeHtml(connection.additionalDelaySeconds || 0)}"></label>${hidden("forward", connection.instructions?.forward || "")}${hidden("backward", connection.instructions?.backward || "")}<button type="submit">Salva impostazioni</button></form>` : `<dl class="venue-command-facts"><div><dt>Distanza</dt><dd>${Number(connection.distanceMeters || 0).toFixed(1)} m</dd></div><div><dt>Direzione</dt><dd>${connection.directionality === "directed" ? "Una direzione" : "Bidirezionale"}</dd></div></dl>`;
    } else if (activeTab === "instructions") {
      panel = editable ? `<form data-connection-editor="${escapeHtml(id(connection._id))}" class="venue-inline-form venue-detail-form">${hidden("connectionTypeDefinitionId", connection.connectionTypeDefinitionId || "")}${hidden("directionality", connection.directionality || "bidirectional")}${hidden("metricMode", connection.metricMode || "manual_override")}${hidden("distanceMeters", connection.distanceMeters || "")}${hidden("additionalDelaySeconds", connection.additionalDelaySeconds || 0)}<label>Istruzione ${escapeHtml(from?.label || "origine")} → ${escapeHtml(to?.label || "destinazione")}<textarea name="forward" rows="6" placeholder="Es. Esci dalla sala e prosegui lungo il corridoio">${escapeHtml(connection.instructions?.forward || "")}</textarea></label><label>Istruzione ${escapeHtml(to?.label || "destinazione")} → ${escapeHtml(from?.label || "origine")}<textarea name="backward" rows="6" placeholder="Es. Torna lungo lo stesso corridoio">${escapeHtml(connection.instructions?.backward || "")}</textarea></label><button type="submit">Salva indicazioni</button></form>` : `<div class="venue-detail-copy"><section><strong>${escapeHtml(from?.label || "Origine")} → ${escapeHtml(to?.label || "Destinazione")}</strong><p>${escapeHtml(connection.instructions?.forward || "Nessuna indicazione configurata")}</p></section><section><strong>${escapeHtml(to?.label || "Destinazione")} → ${escapeHtml(from?.label || "Origine")}</strong><p>${escapeHtml(connection.instructions?.backward || "Nessuna indicazione configurata")}</p></section></div>`;
    } else if (activeTab === "route") {
      const floorLabel = sameFloor ? floor?.label || "Piano" : `${floorsById.get(id(from?.floorId))?.label || "Piano"} ↕ ${floorsById.get(id(to?.floorId))?.label || "Piano"}`;
      panel = `<div class="venue-detail-grid"><section class="venue-detail-summary"><h3>Percorso</h3><dl class="venue-command-facts"><div><dt>Posizione</dt><dd>${escapeHtml(floorLabel)}</dd></div><div><dt>Geometria</dt><dd>${connection.geometry?.points?.length > 2 ? `${connection.geometry.points.length - 2} punti intermedi` : "Linea diretta"}</dd></div><div><dt>Calibrazione</dt><dd>${sameFloor ? (calibrated ? "Disponibile" : "Non disponibile") : "Non applicabile tra piani"}</dd></div><div><dt>Metrica</dt><dd>${escapeHtml(connection.metricMode || "manual_override")}</dd></div></dl>${editable && sameFloor ? `<button class="button-secondary" type="button" data-edit-connection-geometry="${escapeHtml(id(connection._id))}">Ridisegna sulla mappa</button>` : ""}</section>${editable && sameFloor && calibrated ? `<form data-length-constraint-authoring="${escapeHtml(id(connection._id))}" class="venue-inline-form venue-detail-form"><strong>Disegna con lunghezza vincolata</strong><p class="note">Imposta la lunghezza reale richiesta e disegna il percorso sulla planimetria calibrata.</p><label>Lunghezza richiesta (m)<input name="distanceMeters" type="number" min="0.1" step="0.1" value="${escapeHtml(connection.distanceMeters || "")}" required></label><button type="submit">Disegna sulla mappa</button></form>` : ""}</div>`;
    } else {
      panel = editable ? attributeEditorList(definitions, connection, "connection", id(connection._id)) : `<p class="note">Le caratteristiche fisiche sono disponibili in modifica nella bozza di lavoro.</p>`;
    }
    const title = `${from?.label || "?"} → ${to?.label || "?"}`;
    const subtitle = sameFloor ? escapeHtml(floor?.label || "Piano") : `${escapeHtml(floorsById.get(id(from?.floorId))?.label || "Piano")} ↕ ${escapeHtml(floorsById.get(id(to?.floorId))?.label || "Piano")}`;
    const danger = editable ? `<section class="venue-detail-danger"><div><strong>Rimuovi collegamento</strong><p>Il collegamento non sarà più disponibile nel grafo della bozza di lavoro.</p></div><button class="danger" type="button" data-remove-connection="${escapeHtml(id(connection._id))}" data-label="${escapeHtml(title)}">Rimuovi collegamento</button></section>` : "";
    return detailShell({ eyebrow: "Collegamento", title, subtitle, tabs: [["general", "Generale"], ["instructions", "Indicazioni"], ["route", "Percorso"], ["attributes", "Caratteristiche"]], activeTab, panel, danger });
  },

  renderSlotSpatialEditor(editable, editor) {
    const layout = this.data.layout || {};
    const slot = (layout.exhibitSlots || []).find((entry) => id(entry.exhibitSlotId) === id(editor.id));
    const place = (layout.places || []).find((entry) => id(entry._id) === id(slot?.placeId));
    if (!slot || !place) return `<div class="empty-state"><h3>Slot non disponibile</h3><button type="button" data-close-spatial-editor>Torna alla mappa</button></div>`;
    const floor = (layout.floors || []).find((entry) => id(entry._id) === id(place.floorId));
    const targets = this.data.targets || [];
    const assigned = assignedTargetForSlot(targets, slot.exhibitSlotId);
    const availableTargets = targets;
    const incoming = incomingConnections(layout, place._id);
    const incomingOptions = incoming.map((entry) => {
      const sourcePlaceId = id(entry.toPlaceId) === id(place._id) ? entry.fromPlaceId : entry.toPlaceId;
      const source = (layout.places || []).find((candidate) => id(candidate._id) === id(sourcePlaceId));
      return `<option value="${escapeHtml(id(entry._id))}">${escapeHtml(source?.label || "Luogo")} → ${escapeHtml(place.label || "Luogo")}</option>`;
    }).join("");
    const siblingSlots = (layout.exhibitSlots || []).filter((entry) => id(entry.placeId) === id(place._id) && id(entry.exhibitSlotId) !== id(slot.exhibitSlotId));
    const sourceSlotOptions = siblingSlots.map((entry) => `<option value="${escapeHtml(id(entry.exhibitSlotId))}">${escapeHtml(entry.label)}</option>`).join("");
    const overrideList = (slot.approachGuidance?.overrides || []).map((override) => {
      const sourceId = override.sourceKind === "incoming_connection" ? id(override.sourceConnectionId) : id(override.sourceExhibitSlotId);
      let sourceLabel = "Origine non disponibile";
      if (override.sourceKind === "incoming_connection") {
        const sourceConnection = incoming.find((entry) => id(entry._id) === sourceId);
        const sourcePlaceId = id(sourceConnection?.toPlaceId) === id(place._id) ? sourceConnection?.fromPlaceId : sourceConnection?.toPlaceId;
        sourceLabel = `Da ${(layout.places || []).find((entry) => id(entry._id) === id(sourcePlaceId))?.label || "un altro luogo"}`;
      } else sourceLabel = `Dallo slot ${siblingSlots.find((entry) => id(entry.exhibitSlotId) === sourceId)?.label || "vicino"}`;
      return `<li><span><strong>${escapeHtml(sourceLabel)}</strong><small>${escapeHtml(override.instruction)}</small></span>${editable ? `<button class="button-secondary small" type="button" data-remove-slot-override="${escapeHtml(id(slot.exhibitSlotId))}" data-override-source-kind="${escapeHtml(override.sourceKind)}" data-override-source-id="${escapeHtml(sourceId)}">Rimuovi</button>` : ""}</li>`;
    }).join("");
    const activeTab = ["entity", "guidance", "advanced"].includes(editor.tab) ? editor.tab : "entity";
    let panel = "";
    if (activeTab === "entity") {
      const assignment = editable ? `<form data-slot-assignment="${escapeHtml(id(slot.exhibitSlotId))}" class="venue-inline-form venue-detail-form"><label>Entità esposta<select name="venueTargetId"><option value="">Nessuna entità</option>${availableTargets.map((entry) => `<option value="${escapeHtml(id(entry.id))}" ${selected(entry.id, assigned?.id)}>${escapeHtml(targetAssignmentLabel(entry, assigned?.id))}</option>`).join("")}</select></label><small>Scegliendo un’entità già collocata, ArtAround la ricolloca qui e libera lo slot precedente.</small><button type="submit">${assigned ? "Cambia entità" : "Assegna entità"}</button></form>` : "";
      panel = `<div class="venue-detail-grid"><section class="venue-detail-summary"><span class="eyebrow">Entità corrente</span><h3>${escapeHtml(assigned?.label || "Slot libero")}</h3><p>${escapeHtml(assigned?.subject?.preferredLabel || assigned?.description || "Nessuna entità assegnata")}</p>${assigned ? `<a class="button-link secondary" data-route href="/workspace/item-authoring?venueTargetId=${encodeURIComponent(id(assigned.id))}">Crea contenuto</a>` : ""}</section>${assignment}</div>`;
    } else if (activeTab === "guidance") {
      panel = `${editable ? `<form data-slot-editor="${escapeHtml(id(slot.exhibitSlotId))}" class="venue-inline-form venue-detail-form">${hidden("label", slot.label)}${hidden("placeId", id(slot.placeId))}${hidden("order", slot.order ?? "")}<label>Indicazione predefinita<textarea name="defaultInstruction" rows="6" placeholder="Es. L’opera si trova sulla parete alla tua destra">${escapeHtml(slot.approachGuidance?.defaultInstruction || "")}</textarea></label><div class="venue-form-intro"><strong>Indicazione specifica per provenienza</strong><small>Usata solo quando il visitatore arriva da quel collegamento o da quello slot.</small></div><label>Da collegamento<select name="sourceConnectionId"><option value="">Nessun collegamento</option>${incomingOptions}</select></label><label>Da slot vicino<select name="sourceExhibitSlotId"><option value="">Nessuno slot</option>${sourceSlotOptions}</select></label><label>Istruzione specifica<textarea name="overrideInstruction" rows="4" placeholder="Es. L’opera è alla tua destra"></textarea></label><button type="submit">Salva indicazioni</button></form>` : `<p>${escapeHtml(slot.approachGuidance?.defaultInstruction || "Nessuna indicazione predefinita")}</p>`}${overrideList ? `<section class="venue-approach-overrides"><strong>Indicazioni specifiche configurate</strong><ul>${overrideList}</ul></section>` : ""}`;
    } else {
      panel = `<div class="venue-detail-grid">${editable ? `<form data-slot-editor="${escapeHtml(id(slot.exhibitSlotId))}" class="venue-inline-form venue-detail-form"><label>Etichetta<input name="label" value="${escapeHtml(slot.label)}" required></label><label>Luogo<select name="placeId">${(layout.places || []).map((entry) => `<option value="${escapeHtml(id(entry._id))}" ${selected(entry._id, slot.placeId)}>${escapeHtml(entry.label || "Luogo")}</option>`).join("")}</select></label><label>Ordine<input name="order" type="number" min="0" value="${slot.order ?? ""}"></label>${hidden("defaultInstruction", slot.approachGuidance?.defaultInstruction || "")}<button type="submit">Salva dati slot</button></form>` : ""}<aside class="venue-detail-summary"><span class="eyebrow">Public code</span><code class="slot-public-code">${escapeHtml(slot.publicCode || "Codice non disponibile")}</code>${slot.publicCode ? `<button class="button-secondary" type="button" data-copy-slot-code="${escapeHtml(slot.publicCode)}">Copia codice</button>` : ""}</aside></div>`;
    }
    const breadcrumb = `<button class="button-link" type="button" data-open-spatial-place="${escapeHtml(id(place._id))}">‹ ${escapeHtml(place.label || "Luogo")}</button>`;
    const danger = editable ? `<section class="venue-detail-danger"><div><strong>Rimuovi slot</strong><p>L’entità eventualmente esposta resterà nell’inventario della sede.</p></div><button class="danger" type="button" data-remove-slot="${escapeHtml(id(slot.exhibitSlotId))}" data-label="${escapeHtml(slot.label)}">Rimuovi slot</button></section>` : "";
    return detailShell({ eyebrow: "Slot espositivo", title: slot.label, subtitle: `${escapeHtml(place.label || "Luogo")} · ${escapeHtml(floor?.label || "Piano")}`, tabs: [["entity", "Entità"], ["guidance", "Indicazioni"], ["advanced", "Avanzate"]], activeTab, panel, danger, breadcrumb });
  },
};
