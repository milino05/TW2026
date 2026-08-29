import { navigate } from "../application/router.js";
import { managementRepository } from "../infrastructure/http/management-repository.js";

function id(value) { return String(value?._id || value?.id || value || ""); }
function clamp(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
function mapPoint(event, surface) {
  const rect = surface.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x: clamp((event.clientX - rect.left) / rect.width),
    y: clamp((event.clientY - rect.top) / rect.height),
  };
}
function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "").split(",")[1] || ""), { once: true });
    reader.addEventListener("error", () => reject(new Error("Non è stato possibile leggere la planimetria")), { once: true });
    reader.readAsDataURL(file);
  });
}
function canvasAsBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Non è stato possibile ottimizzare la planimetria")),
    mimeType,
    quality,
  ));
}
async function optimizedFloorPlan(file) {
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(file.type)) throw new Error("Usa una planimetria JPEG, PNG o WebP.");
  const maxBytes = 4 * 1024 * 1024;
  if (file.size <= maxBytes) return file;
  if (typeof createImageBitmap !== "function") throw new Error("La planimetria supera 4 MB. Riduci il file prima di caricarlo.");
  const bitmap = await createImageBitmap(file);
  try {
    for (const option of [{ maxSide: 3600, quality: .9 }, { maxSide: 3000, quality: .82 }, { maxSide: 2400, quality: .72 }]) {
      const scale = Math.min(1, option.maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Non è stato possibile preparare la planimetria");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const optimized = await canvasAsBlob(canvas, "image/webp", option.quality);
      if (optimized.size <= maxBytes) return optimized;
    }
  } finally { bitmap.close(); }
  throw new Error("Non è stato possibile ridurre la planimetria sotto 4 MB.");
}
function attributeValue(raw, dataType) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (dataType === "boolean") return text === "true";
  if (dataType === "number") {
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) throw new Error("Inserisci un valore numerico valido.");
    return parsed;
  }
  return text;
}
function connectionContext(layout, connectionId) {
  const connection = (layout?.connections || []).find((entry) => id(entry._id) === id(connectionId));
  if (!connection) return null;
  const from = (layout?.places || []).find((entry) => id(entry._id) === id(connection.fromPlaceId));
  const to = (layout?.places || []).find((entry) => id(entry._id) === id(connection.toPlaceId));
  if (!from || !to) return null;
  return { connection, from, to };
}
function actionGeometryPoints(layout, action) {
  const context = connectionContext(layout, action?.connectionId);
  if (!context) return [];
  return [
    { x: Number(context.from.position?.x), y: Number(context.from.position?.y) },
    ...(action.waypoints || []).map((point) => ({ x: Number(point.x), y: Number(point.y) })),
    { x: Number(context.to.position?.x), y: Number(context.to.position?.y) },
  ];
}
function geometryDistanceMeters(points, floor) {
  const width = Number(floor?.mapAsset?.width);
  const height = Number(floor?.mapAsset?.height);
  const scale = Number(floor?.calibration?.metersPerPixel);
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(scale) || scale <= 0 || points.length < 2) return null;
  let pixels = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    pixels += Math.hypot((to.x - from.x) * width, (to.y - from.y) * height);
  }
  return pixels * scale;
}
function lengthTolerance(distanceMeters) { return Math.max(0.05, Number(distanceMeters) * 0.01); }

export const venueMapAuthoringMixin = {
  mapMode() {
    if (this.draggingPlace || this.pendingMapAction?.type === "move-place") return "dragging_place";
    const action = this.pendingMapAction;
    if (!action) return "idle";
    if (action.type === "create-place") return "placing_place";
    if (action.type === "connect") return action.fromPlaceId ? "connecting_select_to" : "connecting_select_from";
    if (action.type === "placing-slot") return "placing_slot";
    if (action.type === "calibrate") return "calibrating";
    if (action.type === "geometry") return "editing_geometry";
    return "idle";
  },

  cancelMapAction({ render = true } = {}) {
    this.pendingMapAction = null;
    this.draggingPlace = null;
    if (render) this.render();
  },

  locateExhibitSlot(exhibitSlotId) {
    const slot = (this.data.layout?.exhibitSlots || []).find((entry) => id(entry.exhibitSlotId) === id(exhibitSlotId));
    const place = (this.data.layout?.places || []).find((entry) => id(entry._id) === id(slot?.placeId));
    if (!slot || !place) return;
    this.selectedExhibitSlotId = id(slot.exhibitSlotId);
    this.selectedMapPlaceId = id(place._id);
    this.selectedFloorId = id(place.floorId);
    this.activeSpatialTab = "map";
    this.render();
    requestAnimationFrame(() => this.querySelector(`[data-map-place="${CSS.escape(id(place._id))}"]`)?.focus());
  },

  geometryAuthoringState() {
    const action = this.pendingMapAction;
    if (action?.type !== "geometry") return null;
    const context = connectionContext(this.data.layout, action.connectionId);
    if (!context) return null;
    const floor = (this.data.layout?.floors || []).find((entry) => id(entry._id) === id(action.floorId));
    const points = actionGeometryPoints(this.data.layout, action);
    const measuredDistanceMeters = geometryDistanceMeters(points, floor);
    const requestedDistanceMeters = action.metricMode === "length_constrained" ? Number(action.distanceMeters) : null;
    const toleranceMeters = requestedDistanceMeters ? lengthTolerance(requestedDistanceMeters) : null;
    const constraintSatisfied = action.metricMode !== "length_constrained"
      || (Number.isFinite(measuredDistanceMeters) && Math.abs(measuredDistanceMeters - requestedDistanceMeters) <= toleranceMeters);
    return { ...context, floor, points, measuredDistanceMeters, requestedDistanceMeters, toleranceMeters, constraintSatisfied };
  },

  async handleMapAuthoringClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return false;
    if (this.suppressNextMapClick && target.closest("[data-map-place]")) {
      this.suppressNextMapClick = false;
      return true;
    }

    const spatialTab = target.closest("[data-spatial-tab], [data-show-spatial-tab]");
    if (spatialTab) {
      this.activeSpatialTab = spatialTab.dataset.spatialTab || spatialTab.dataset.showSpatialTab;
      this.render();
      return true;
    }
    const arrangementTab = target.closest("[data-arrangement-tab]");
    if (arrangementTab) { this.activeArrangementTab = arrangementTab.dataset.arrangementTab; this.render(); return true; }
    const inventoryFilter = target.closest("[data-inventory-filter]");
    if (inventoryFilter) { this.inventoryFilter = inventoryFilter.dataset.inventoryFilter; this.render(); return true; }
    const locateSlot = target.closest("[data-locate-slot]");
    if (locateSlot) { this.locateExhibitSlot(locateSlot.dataset.locateSlot); return true; }
    const copySlot = target.closest("[data-copy-slot-code]");
    if (copySlot) {
      try { await navigator.clipboard.writeText(copySlot.dataset.copySlotCode); this.message = "Codice dello slot copiato."; }
      catch { this.error = "Non è stato possibile copiare il codice. Selezionalo manualmente."; }
      this.render();
      return true;
    }
    if (target.closest("[data-start-slot]")) {
      this.activeSpatialTab = "arrangement";
      this.activeArrangementTab = "slots";
      this.render();
      requestAnimationFrame(() => this.querySelector("[data-create-slot] input")?.focus());
      return true;
    }

    const mapConnection = target.closest("[data-map-connection]");
    if (mapConnection) {
      this.selectedConnectionId = mapConnection.dataset.mapConnection;
      this.activeSpatialTab = "connections";
      this.render();
      return true;
    }

    const vocabulary = target.closest("[data-edit-physical-vocabulary]");
    if (vocabulary) {
      const vocabularyId = vocabulary.dataset.editPhysicalVocabulary;
      if (vocabularyId) navigate(`/physical-vocabularies/edit?physicalVocabularyId=${encodeURIComponent(vocabularyId)}`);
      return true;
    }

    const floorTab = target.closest("[data-select-floor]");
    if (floorTab) {
      const nextFloorId = floorTab.dataset.selectFloor;
      const action = this.pendingMapAction;
      if (["calibrate", "geometry", "create-place", "move-place"].includes(action?.type) && id(action.floorId) !== id(nextFloorId)) this.pendingMapAction = null;
      this.selectedFloorId = nextFloorId;
      this.render();
      return true;
    }

    if (target.closest("[data-cancel-map-action]")) {
      this.cancelMapAction();
      return true;
    }

    const tool = target.closest("[data-map-tool]");
    if (tool) {
      const floorId = this.activeFloorId?.();
      if (!floorId) return true;
      if (tool.dataset.mapTool === "connect") this.pendingMapAction = { type: "connect", fromPlaceId: null, toPlaceId: null };
      if (tool.dataset.mapTool === "calibrate") this.pendingMapAction = { type: "calibrate", floorId, points: [] };
      this.render();
      return true;
    }

    const geometryEditor = target.closest("[data-edit-connection-geometry]");
    if (geometryEditor) {
      const context = connectionContext(this.data.layout, geometryEditor.dataset.editConnectionGeometry);
      if (!context || id(context.from.floorId) !== id(context.to.floorId)) return true;
      const floorId = id(context.from.floorId);
      const existing = (context.connection.geometry?.points || []).slice(1, -1).map((point) => ({ x: point.x, y: point.y }));
      this.selectedFloorId = floorId;
      this.pendingMapAction = {
        type: "geometry",
        connectionId: id(context.connection._id),
        floorId,
        metricMode: context.connection.metricMode,
        distanceMeters: context.connection.distanceMeters,
        waypoints: existing,
      };
      this.render();
      return true;
    }

    if (target.closest("[data-geometry-undo]")) {
      const action = this.pendingMapAction;
      if (action?.type === "geometry") action.waypoints = (action.waypoints || []).slice(0, -1);
      this.render();
      return true;
    }

    if (target.closest("[data-geometry-clear]")) {
      const action = this.pendingMapAction;
      if (action?.type === "geometry") action.waypoints = [];
      this.render();
      return true;
    }

    if (target.closest("[data-save-geometry]")) {
      const action = this.pendingMapAction;
      const state = this.geometryAuthoringState();
      if (action?.type !== "geometry" || !state) return true;
      if (!state.constraintSatisfied) {
        this.error = "La geometria deve rispettare la lunghezza richiesta prima di poter essere salvata.";
        this.render();
        return true;
      }
      const payload = { metricMode: action.metricMode, geometryPoints: state.points };
      if (action.metricMode !== "geometry_derived") payload.distanceMeters = Number(action.distanceMeters);
      const success = await this.execute(
        () => managementRepository.updateVenueConnection(this.id, action.connectionId, payload),
        action.metricMode === "length_constrained" ? "Percorso salvato con la lunghezza vincolata." : "Geometria del collegamento aggiornata.",
      );
      if (success) { this.pendingMapAction = null; this.render(); }
      return true;
    }

    const move = target.closest("[data-position-place]");
    if (move) {
      const place = (this.data.layout?.places || []).find((entry) => id(entry._id) === id(move.dataset.positionPlace));
      if (place) {
        this.selectedFloorId = id(place.floorId);
        this.pendingMapAction = { type: "move-place", placeId: id(place._id), floorId: id(place.floorId) };
        this.render();
      }
      return true;
    }

    const placeNode = target.closest("[data-map-place]");
    if (placeNode) {
      const placeId = placeNode.dataset.mapPlace;
      const place = (this.data.layout?.places || []).find((entry) => id(entry._id) === id(placeId));
      if (!place) return true;
      const action = this.pendingMapAction;
      if (action?.type === "connect") {
        if (!action.fromPlaceId) action.fromPlaceId = placeId;
        else if (id(action.fromPlaceId) !== id(placeId)) action.toPlaceId = placeId;
        this.render();
        return true;
      }
      if (action?.type === "placing-slot") {
        const success = await this.execute(
          () => managementRepository.createExhibitSlot(this.id, { placeId, label: action.label, order: action.order }),
          "Slot espositivo creato e posizionato.",
        );
        if (success) { this.pendingMapAction = null; this.activeSpatialTab = "arrangement"; this.activeArrangementTab = "slots"; this.render(); }
        return true;
      }
      if (action?.type === "geometry") return true;
      this.selectedMapPlaceId = placeId;
      this.render();
      return true;
    }

    const surface = target.closest("[data-map-surface]");
    if (!surface || !this.pendingMapAction) return false;
    const action = this.pendingMapAction;
    const point = mapPoint(event, surface);
    if (!point) return true;
    const surfaceFloorId = surface.dataset.floorId;

    if (action.type === "create-place") {
      if (id(action.floorId) !== id(surfaceFloorId)) return true;
      const payload = {
        floorId: action.floorId,
        placeTypeDefinitionId: action.placeTypeDefinitionId,
        label: action.label,
        position: point,
      };
      const success = await this.execute(() => managementRepository.createVenuePlace(this.id, payload), "Luogo aggiunto sulla mappa.");
      if (success) { this.pendingMapAction = null; this.render(); }
      return true;
    }

    if (action.type === "move-place") {
      if (id(action.floorId) !== id(surfaceFloorId)) return true;
      const success = await this.execute(() => managementRepository.moveVenuePlace(this.id, action.placeId, point), "Posizione del luogo aggiornata.");
      if (success) { this.pendingMapAction = null; this.render(); }
      return true;
    }

    if (action.type === "calibrate") {
      if (id(action.floorId) !== id(surfaceFloorId)) return true;
      action.points = [...(action.points || []), point].slice(0, 2);
      this.render();
      return true;
    }

    if (action.type === "geometry") {
      if (id(action.floorId) !== id(surfaceFloorId)) return true;
      action.waypoints = [...(action.waypoints || []), point].slice(0, 40);
      this.render();
      return true;
    }

    return false;
  },

  async handleMapAuthoringSubmit(form, data) {
    if (form.matches("[data-create-slot]")) {
      this.pendingMapAction = {
        type: "placing-slot",
        label: String(data.get("label") || "").trim(),
        order: String(data.get("order") || "").trim() ? Number(data.get("order")) : null,
      };
      this.activeSpatialTab = "map";
      this.render();
      return true;
    }

    if (form.matches("[data-slot-assignment]")) {
      const exhibitSlotId = form.dataset.slotAssignment;
      const targetId = String(data.get("venueTargetId") || "");
      const current = (this.data.layout?.exhibitSlots || []).find((entry) => id(entry.exhibitSlotId) === id(exhibitSlotId))?.assignedVenueTargetId;
      await this.execute(async () => {
        if (current && id(current) !== id(targetId)) await managementRepository.unassignVenueTargetFromExhibitSlot(this.id, current);
        if (targetId) await managementRepository.assignVenueTargetToExhibitSlot(this.id, exhibitSlotId, targetId);
      },
        targetId ? "Entità assegnata allo slot." : "Slot liberato.",
      );
      return true;
    }

    if (form.matches("[data-slot-editor]")) {
      const sourceConnectionId = String(data.get("sourceConnectionId") || "");
      const sourceExhibitSlotId = String(data.get("sourceExhibitSlotId") || "");
      const instruction = String(data.get("overrideInstruction") || "").trim();
      const overrides = instruction && (sourceConnectionId || sourceExhibitSlotId) ? [{ instruction, ...(sourceConnectionId ? { sourceConnectionId } : { sourceExhibitSlotId }) }] : [];
      await this.execute(() => managementRepository.updateExhibitSlot(this.id, form.dataset.slotEditor, {
        label: String(data.get("label") || "").trim(),
        placeId: String(data.get("placeId") || ""),
        order: String(data.get("order") || "").trim() ? Number(data.get("order")) : null,
        approachGuidance: { defaultInstruction: String(data.get("defaultInstruction") || "").trim() || null, overrides },
      }), "Slot espositivo aggiornato.");
      return true;
    }

    if (form.matches("[data-place-positioning]")) {
      const floorId = this.activeFloorId?.();
      if (!floorId) throw new Error("Seleziona prima un piano.");
      this.pendingMapAction = {
        type: "create-place",
        floorId,
        label: String(data.get("label") || "").trim(),
        placeTypeDefinitionId: String(data.get("placeTypeDefinitionId") || ""),
      };
      this.render();
      return true;
    }

    if (form.matches("[data-connection-composer]")) {
      const action = this.pendingMapAction;
      if (action?.type !== "connect" || !action.fromPlaceId || !action.toPlaceId) return true;
      const metricMode = String(data.get("metricMode") || "manual_override");
      const payload = {
        fromPlaceId: action.fromPlaceId,
        toPlaceId: action.toPlaceId,
        connectionTypeDefinitionId: String(data.get("connectionTypeDefinitionId") || "") || null,
        directionality: String(data.get("directionality") || "bidirectional"),
        metricMode,
        additionalDelaySeconds: Number(data.get("additionalDelaySeconds") || 0),
      };
      if (metricMode !== "geometry_derived") payload.distanceMeters = Number(data.get("distanceMeters"));
      const success = await this.execute(() => managementRepository.createVenueConnection(this.id, payload), "Collegamento aggiunto alla mappa.");
      if (success) { this.pendingMapAction = null; this.render(); }
      return true;
    }

    if (form.matches("[data-length-constraint-authoring]")) {
      const context = connectionContext(this.data.layout, form.dataset.lengthConstraintAuthoring);
      const distanceMeters = Number(data.get("distanceMeters"));
      if (!context || !Number.isFinite(distanceMeters) || distanceMeters <= 0) return true;
      if (id(context.from.floorId) !== id(context.to.floorId)) throw new Error("La lunghezza vincolata richiede un collegamento sullo stesso piano.");
      const floor = (this.data.layout?.floors || []).find((entry) => id(entry._id) === id(context.from.floorId));
      if (!floor?.mapAsset || !floor?.calibration) throw new Error("Calibra prima la planimetria del piano.");
      this.selectedFloorId = id(context.from.floorId);
      this.pendingMapAction = {
        type: "geometry",
        connectionId: id(context.connection._id),
        floorId: id(context.from.floorId),
        metricMode: "length_constrained",
        distanceMeters,
        waypoints: (context.connection.geometry?.points || []).slice(1, -1).map((point) => ({ x: point.x, y: point.y })),
      };
      this.render();
      return true;
    }

    if (form.matches("[data-calibration-distance]")) {
      const action = this.pendingMapAction;
      if (action?.type !== "calibrate" || action.points?.length !== 2) return true;
      const success = await this.execute(() => managementRepository.calibrateVenueFloor(this.id, action.floorId, {
        method: "line",
        distanceMeters: Number(data.get("distanceMeters")),
        line: { from: action.points[0], to: action.points[1] },
      }), "Piano calibrato dalla mappa.");
      if (success) { this.pendingMapAction = null; this.render(); }
      return true;
    }

    if (form.matches("[data-physical-attribute]")) {
      const entityType = form.dataset.entityType;
      const entityId = form.dataset.entityId;
      const definitionId = form.dataset.definitionId;
      const value = attributeValue(data.get("value"), form.dataset.dataType);
      const operation = entityType === "place"
        ? () => managementRepository.setVenuePlaceAttribute(this.id, entityId, definitionId, value)
        : () => managementRepository.setVenueConnectionAttribute(this.id, entityId, definitionId, value);
      await this.execute(operation, value === null ? "Caratteristica impostata come non verificata." : "Caratteristica fisica aggiornata.");
      return true;
    }

    return false;
  },

  onMapPointerDown(event) {
    if (event.button !== 0 || this.pendingMapAction || this.busy) return;
    const node = event.target instanceof Element ? event.target.closest("[data-map-place]") : null;
    const surface = node?.closest("[data-map-surface]");
    if (!node || !surface) return;
    const place = (this.data.layout?.places || []).find((entry) => id(entry._id) === id(node.dataset.mapPlace));
    if (!place) return;
    node.setPointerCapture?.(event.pointerId);
    this.draggingPlace = {
      pointerId: event.pointerId,
      placeId: id(place._id),
      floorId: id(place.floorId),
      node,
      surface,
      startX: event.clientX,
      startY: event.clientY,
      point: { x: Number(place.position?.x), y: Number(place.position?.y) },
      moved: false,
    };
  },

  onMapPointerMove(event) {
    const drag = this.draggingPlace;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = mapPoint(event, drag.surface);
    if (!point) return;
    drag.point = point;
    drag.moved = drag.moved || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4;
    if (drag.moved) {
      event.preventDefault();
      drag.node.style.left = `${point.x * 100}%`;
      drag.node.style.top = `${point.y * 100}%`;
      drag.node.classList.add("dragging");
    }
  },

  async onMapPointerUp(event) {
    const drag = this.draggingPlace;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.draggingPlace = null;
    drag.node.releasePointerCapture?.(event.pointerId);
    if (!drag.moved) return;
    this.suppressNextMapClick = true;
    const connections = (this.data.layout?.connections || []).filter((entry) => [id(entry.fromPlaceId), id(entry.toPlaceId)].includes(drag.placeId) && entry.geometry?.points?.length);
    const connectionGeometryUpdates = connections.map((connection) => {
      const points = connection.geometry.points.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
      if (id(connection.fromPlaceId) === drag.placeId) points[0] = drag.point;
      if (id(connection.toPlaceId) === drag.placeId) points[points.length - 1] = drag.point;
      return { connectionId: id(connection._id), geometryPoints: points };
    });
    await this.execute(() => managementRepository.moveVenuePlace(this.id, drag.placeId, { position: drag.point, connectionGeometryUpdates }), "Luogo e geometrie incidenti aggiornati.");
  },

  onMapPointerCancel(event) {
    if (!this.draggingPlace || this.draggingPlace.pointerId !== event.pointerId) return;
    this.draggingPlace = null;
    this.render();
  },

  onMapDoubleClick(event) {
    const place = event.target instanceof Element ? event.target.closest("[data-map-place]") : null;
    if (!place || this.pendingMapAction) return;
    this.selectedMapPlaceId = place.dataset.mapPlace;
    this.activeSpatialTab = "places";
    this.render();
    requestAnimationFrame(() => this.querySelector(`[data-place-editor="${CSS.escape(this.selectedMapPlaceId)}"] input`)?.focus());
  },

  async onChange(event) {
    const floorSelect = event.target instanceof HTMLSelectElement ? event.target.closest("[data-floor-select]") : null;
    if (floorSelect) {
      this.selectedFloorId = floorSelect.value;
      if (["calibrate", "geometry", "create-place", "move-place"].includes(this.pendingMapAction?.type)) this.pendingMapAction = null;
      this.render();
      return;
    }
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    if (!input?.matches("[data-floor-plan-input]")) return;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const optimized = await optimizedFloorPlan(file);
      const dataBase64 = await fileAsBase64(optimized);
      await this.execute(() => managementRepository.uploadVenueFloorPlan(this.id, input.dataset.floorId, {
        fileName: file.name,
        mimeType: optimized.type || file.type,
        dataBase64,
      }), "Planimetria caricata e collegata al piano.");
      this.selectedFloorId = input.dataset.floorId;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Caricamento della planimetria non riuscito";
      this.render();
    } finally {
      input.value = "";
    }
  },
};
