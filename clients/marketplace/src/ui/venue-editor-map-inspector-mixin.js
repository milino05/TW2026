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
function attributeEditors(definitions, entity, entityType, entityId) {
  const applicable = (definitions.physicalAttributes || []).filter((definition) => [entityType, "both"].includes(definition.appliesTo));
  if (!applicable.length) return "";
  return `<details class="venue-physical-attributes"><summary>Caratteristiche fisiche</summary><div class="venue-attribute-list">${applicable.map((definition) => {
    const current = valueForAttribute(entity, definition.definitionId);
    return `<form data-physical-attribute data-entity-type="${escapeHtml(entityType)}" data-entity-id="${escapeHtml(entityId)}" data-definition-id="${escapeHtml(definition.definitionId)}" data-data-type="${escapeHtml(definition.dataType)}" class="venue-attribute-row"><label><span>${escapeHtml(definition.label)}</span><small>${escapeHtml(definition.description || (definition.unit ? `Unità: ${definition.unit}` : "Valore fisico usato dal routing"))}</small>${attributeInput(definition, current)}</label><button class="button-secondary small" type="submit">Salva</button></form>`;
  }).join("")}</div></details>`;
}
function assignedTargetForSlot(targets, slotId) {
  return (targets || []).find((target) => id(target.exhibitSlot?.id || target.exhibitSlot?._id) === id(slotId));
}

export const venueMapInspectorMixin = {
  async handleMapAuthoringClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return false;

    const inspectorTab = target.closest("[data-map-inspector-tab]");
    if (inspectorTab) {
      this.activeMapInspectorTab = inspectorTab.dataset.mapInspectorTab || "details";
      this.render();
      return true;
    }

    const closeInspector = target.closest("[data-close-map-inspector]");
    if (closeInspector) {
      this.selectedMapPlaceId = null;
      this.selectedConnectionId = null;
      this.activeMapInspectorTab = "details";
      this.render();
      return true;
    }

    const mapConnection = target.closest("[data-map-connection]");
    if (mapConnection && !this.pendingMapAction) {
      this.selectedConnectionId = mapConnection.dataset.mapConnection;
      this.selectedMapPlaceId = null;
      this.activeMapInspectorTab = "details";
      this.activeSpatialTab = "map";
      this.render();
      requestAnimationFrame(() => this.querySelector(".venue-map-inspector input, .venue-map-inspector select")?.focus());
      return true;
    }

    return venueMapAuthoringMixin.handleMapAuthoringClick.call(this, event);
  },

  async handleMapAuthoringSubmit(form, data) {
    if (form.matches("[data-inspector-create-slot]")) {
      const placeId = form.dataset.inspectorCreateSlot;
      const label = String(data.get("label") || "").trim();
      const orderText = String(data.get("order") || "").trim();
      await this.execute(
        () => this.managementRepository?.createExhibitSlot
          ? this.managementRepository.createExhibitSlot(this.id, { placeId, label, order: orderText ? Number(orderText) : null })
          : import("../infrastructure/http/management-repository.js").then(({ managementRepository }) => managementRepository.createExhibitSlot(this.id, { placeId, label, order: orderText ? Number(orderText) : null })),
        "Slot espositivo creato nel luogo selezionato.",
      );
      this.activeMapInspectorTab = "slots";
      return true;
    }
    return venueMapAuthoringMixin.handleMapAuthoringSubmit.call(this, form, data);
  },

  onMapDoubleClick(event) {
    if (this.pendingMapAction) return;
    const target = event.target instanceof Element ? event.target : null;
    const place = target?.closest("[data-map-place]");
    const connection = target?.closest("[data-map-connection]");
    if (place) {
      this.selectedMapPlaceId = place.dataset.mapPlace;
      this.selectedConnectionId = null;
      this.activeMapInspectorTab = "details";
      this.activeSpatialTab = "map";
      this.render();
      requestAnimationFrame(() => this.querySelector(".venue-map-inspector input, .venue-map-inspector select")?.focus());
    } else if (connection) {
      this.selectedConnectionId = connection.dataset.mapConnection;
      this.selectedMapPlaceId = null;
      this.activeSpatialTab = "map";
      this.render();
    }
  },

  renderMapInspector(editable) {
    const layout = this.data.layout || {};
    const definitions = this.physicalDefinitions();
    const place = (layout.places || []).find((entry) => id(entry._id) === id(this.selectedMapPlaceId));
    const connection = (layout.connections || []).find((entry) => id(entry._id) === id(this.selectedConnectionId));
    const placesById = new Map((layout.places || []).map((entry) => [id(entry._id), entry]));
    const floorsById = new Map((layout.floors || []).map((entry) => [id(entry._id), entry]));

    if (connection) {
      const from = placesById.get(id(connection.fromPlaceId));
      const to = placesById.get(id(connection.toPlaceId));
      const sameFloor = from && to && id(from.floorId) === id(to.floorId);
      const floor = sameFloor ? floorsById.get(id(from.floorId)) : null;
      const calibrated = Boolean(floor?.calibration);
      const metricOptions = calibrated
        ? `<option value="manual_override" ${selected("manual_override", connection.metricMode)}>Distanza manuale</option><option value="geometry_derived" ${selected("geometry_derived", connection.metricMode)}>Dalla geometria calibrata</option>${connection.metricMode === "length_constrained" ? `<option value="length_constrained" selected>Lunghezza vincolata</option>` : ""}`
        : `<option value="manual_override" selected>Distanza manuale</option>`;
      return `<aside class="venue-map-inspector venue-map-inspector--connection"><header class="venue-map-inspector-header"><div><span class="eyebrow">Collegamento</span><h3>${escapeHtml(from?.label || "?")} → ${escapeHtml(to?.label || "?")}</h3></div><button class="button-secondary small" type="button" data-close-map-inspector aria-label="Chiudi inspector">×</button></header><p>${sameFloor ? escapeHtml(floor?.label || "Piano") : `${escapeHtml(floorsById.get(id(from?.floorId))?.label || "Piano")} ↕ ${escapeHtml(floorsById.get(id(to?.floorId))?.label || "Piano")}`}</p>${editable ? `<form data-connection-editor="${escapeHtml(id(connection._id))}" class="venue-inline-form venue-inspector-form"><label>Tipo<select name="connectionTypeDefinitionId"><option value="">Senza tipo specifico</option>${definitions.connectionTypes.map((type) => `<option value="${escapeHtml(type.definitionId)}" ${selected(type.definitionId, connection.connectionTypeDefinitionId)}>${escapeHtml(type.label)}</option>`).join("")}</select></label><label>Direzione<select name="directionality"><option value="bidirectional" ${selected("bidirectional", connection.directionality)}>Entrambe</option><option value="directed" ${selected("directed", connection.directionality)}>Solo da → a</option></select></label><label>Misurazione<select name="metricMode">${metricOptions}</select></label><label>Distanza (m)<input name="distanceMeters" type="number" min="0.1" step="0.1" value="${escapeHtml(connection.distanceMeters || "")}" ${connection.metricMode === "geometry_derived" ? "readonly" : ""}></label><label>Ritardo aggiuntivo (s)<input name="additionalDelaySeconds" type="number" min="0" step="1" value="${escapeHtml(connection.additionalDelaySeconds || 0)}"></label><label>Istruzione ${escapeHtml(from?.label || "andata")} → ${escapeHtml(to?.label || "destinazione")}<input name="forward" value="${escapeHtml(connection.instructions?.forward || "")}"></label><label>Istruzione ${escapeHtml(to?.label || "ritorno")} → ${escapeHtml(from?.label || "origine")}<input name="backward" value="${escapeHtml(connection.instructions?.backward || "")}"></label><button type="submit">Salva collegamento</button></form>${sameFloor ? `<button class="button-secondary" type="button" data-edit-connection-geometry="${escapeHtml(id(connection._id))}">Ridisegna percorso</button>` : ""}${attributeEditors(definitions, connection, "connection", id(connection._id))}<button class="danger small" type="button" data-remove-connection="${escapeHtml(id(connection._id))}">Rimuovi collegamento</button>` : `<dl class="venue-command-facts"><div><dt>Distanza</dt><dd>${Number(connection.distanceMeters || 0).toFixed(1)} m</dd></div><div><dt>Direzione</dt><dd>${connection.directionality === "directed" ? "Una direzione" : "Bidirezionale"}</dd></div></dl>`}</aside>`;
    }

    if (!place) return `<aside class="venue-map-inspector empty"><span class="eyebrow">Inspector</span><h3>Seleziona un elemento</h3><p>Fai clic su un luogo o un collegamento. Il pannello resta aperto accanto alla mappa senza spostarti nelle liste.</p></aside>`;

    const floor = floorsById.get(id(place.floorId));
    const slots = (layout.exhibitSlots || []).filter((entry) => id(entry.placeId) === id(place._id));
    const type = definitions.placeTypes.find((entry) => id(entry.definitionId) === id(place.placeTypeDefinitionId));
    const tab = this.activeMapInspectorTab === "slots" ? "slots" : "details";
    const tabs = `<nav class="venue-map-inspector-tabs" role="tablist"><button type="button" data-map-inspector-tab="details" aria-selected="${tab === "details"}">Dettagli</button><button type="button" data-map-inspector-tab="slots" aria-selected="${tab === "slots"}">Slot espositivi <span class="count">${slots.length}</span></button></nav>`;

    const details = editable
      ? `<form data-place-editor="${escapeHtml(id(place._id))}" class="venue-inline-form venue-inspector-form"><label>Nome<input name="label" value="${escapeHtml(place.label || "")}" required></label><label>Tipo<select name="placeTypeDefinitionId">${definitions.placeTypes.map((entry) => `<option value="${escapeHtml(entry.definitionId)}" ${selected(entry.definitionId, place.placeTypeDefinitionId)}>${escapeHtml(entry.label)}</option>`).join("")}</select></label><button type="submit">Salva dettagli</button></form><dl class="venue-command-facts"><div><dt>Piano</dt><dd>${escapeHtml(floor?.label || "Piano")}</dd></div><div><dt>Posizione</dt><dd>${Number(place.position?.x || 0).toFixed(2)}, ${Number(place.position?.y || 0).toFixed(2)}</dd></div></dl>${attributeEditors(definitions, place, "place", id(place._id))}<div class="button-row"><button class="button-secondary small" type="button" data-position-place="${escapeHtml(id(place._id))}">Sposta con clic</button><button class="danger small" type="button" data-remove-place="${escapeHtml(id(place._id))}">Rimuovi luogo</button></div>`
      : `<p>${escapeHtml(type?.label || "Tipo non disponibile")} · ${escapeHtml(floor?.label || "Piano")}</p>`;

    const targets = this.data.targets || [];
    const slotCards = slots.map((slot) => {
      const slotId = id(slot.exhibitSlotId);
      const assigned = assignedTargetForSlot(targets, slotId);
      const availableTargets = targets.filter((entry) => !entry.exhibitSlot || id(entry.id) === id(assigned?.id));
      return `<article class="venue-inspector-slot"><header><strong>${escapeHtml(slot.label)}</strong><span class="chip">${assigned ? escapeHtml(assigned.label) : "Libero"}</span></header>${editable ? `<form data-slot-assignment="${escapeHtml(slotId)}" class="venue-inline-form"><label>Entità<select name="venueTargetId"><option value="">Nessuna entità</option>${availableTargets.map((entry) => `<option value="${escapeHtml(id(entry.id))}" ${selected(entry.id, assigned?.id)}>${escapeHtml(entry.label)}</option>`).join("")}</select></label><button type="submit">${assigned ? "Cambia" : "Assegna"}</button></form><form data-slot-editor="${escapeHtml(slotId)}" class="venue-inline-form"><input type="hidden" name="placeId" value="${escapeHtml(id(place._id))}"><input type="hidden" name="order" value="${slot.order ?? ""}"><label>Etichetta<input name="label" value="${escapeHtml(slot.label)}" required></label><label>Istruzione predefinita<textarea name="defaultInstruction">${escapeHtml(slot.approachGuidance?.defaultInstruction || "")}</textarea></label><button type="submit">Salva slot</button></form>` : ""}</article>`;
    }).join("");
    const slotsPanel = `<div class="venue-inspector-slot-list">${slotCards || `<p class="note">Nessuno slot in questo luogo.</p>`}</div>${editable ? `<form data-inspector-create-slot="${escapeHtml(id(place._id))}" class="venue-inline-form venue-inspector-create-slot"><strong>Nuovo slot in ${escapeHtml(place.label || "questo luogo")}</strong><label>Etichetta<input name="label" required placeholder="Es. Parete destra · posizione 2"></label><label>Ordine facoltativo<input name="order" type="number" min="0"></label><button type="submit">Crea slot</button></form>` : ""}`;

    return `<aside class="venue-map-inspector"><header class="venue-map-inspector-header"><div><span class="eyebrow">Luogo</span><h3>${escapeHtml(place.label || "Luogo senza nome")}</h3></div><button class="button-secondary small" type="button" data-close-map-inspector aria-label="Chiudi inspector">×</button></header>${tabs}<div class="venue-map-inspector-panel">${tab === "slots" ? slotsPanel : details}</div></aside>`;
  },
};
