import { managementRepository } from "../infrastructure/http/management-repository.js";
import { venueMapAuthoringMixin } from "./venue-editor-map-authoring-mixin.js";

function id(value) { return String(value?._id || value?.id || value || ""); }
function clamp(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
function ids(entries, selector) { return new Set((entries || []).map(selector).map(id).filter(Boolean)); }
function createdId(beforeIds, entries, selector) { return (entries || []).map(selector).map(id).find((entryId) => entryId && !beforeIds.has(entryId)) || null; }
function sameFloor(a, b) { return id(a?.floorId) === id(b?.floorId); }

function geometryDistanceMeters(points, floor) {
  const width = Number(floor?.mapAsset?.width);
  const height = Number(floor?.mapAsset?.height);
  const scale = Number(floor?.calibration?.metersPerPixel);
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(scale) || scale <= 0 || points.length < 2) return null;
  let pixels = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    pixels += Math.hypot((Number(to.x) - Number(from.x)) * width, (Number(to.y) - Number(from.y)) * height);
  }
  return pixels * scale;
}

function connectionPoints(layout, connection) {
  const places = layout?.places || [];
  const from = places.find((entry) => id(entry._id) === id(connection?.fromPlaceId));
  const to = places.find((entry) => id(entry._id) === id(connection?.toPlaceId));
  if (!from || !to) return [];
  if (connection?.geometry?.points?.length) return connection.geometry.points.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
  return [
    { x: Number(from.position?.x), y: Number(from.position?.y) },
    { x: Number(to.position?.x), y: Number(to.position?.y) },
  ];
}

function connectionDraftPoints(layout, action) {
  const places = layout?.places || [];
  const from = places.find((entry) => id(entry._id) === id(action?.fromPlaceId));
  const to = places.find((entry) => id(entry._id) === id(action?.toPlaceId));
  if (!from || !to) return [];
  return [
    { x: Number(from.position?.x), y: Number(from.position?.y) },
    ...(action.waypoints || []).map((point) => ({ x: Number(point.x), y: Number(point.y) })),
    { x: Number(to.position?.x), y: Number(to.position?.y) },
  ];
}

function polylineMidpoint(points) {
  if (!points.length) return null;
  if (points.length === 1) return points[0];
  const segments = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const length = Math.hypot(Number(to.x) - Number(from.x), Number(to.y) - Number(from.y));
    segments.push({ from, to, length });
    total += length;
  }
  if (!total) return points[0];
  let remaining = total / 2;
  for (const segment of segments) {
    if (remaining <= segment.length) {
      const ratio = segment.length ? remaining / segment.length : 0;
      return {
        x: Number(segment.from.x) + (Number(segment.to.x) - Number(segment.from.x)) * ratio,
        y: Number(segment.from.y) + (Number(segment.to.y) - Number(segment.from.y)) * ratio,
      };
    }
    remaining -= segment.length;
  }
  return points.at(-1);
}

function labelPlacement(point) {
  if (Number(point?.y) < .16) return "below";
  if (Number(point?.y) > .84) return "above";
  if (Number(point?.x) < .12) return "right";
  if (Number(point?.x) > .88) return "left";
  return "above";
}

function connectionDisplayLabel(connection, placeById, typeById) {
  const from = placeById.get(id(connection.fromPlaceId));
  const to = placeById.get(id(connection.toPlaceId));
  const separator = connection.directionality === "bidirectional" ? "↔" : "→";
  const route = `${from?.label || "Luogo"} ${separator} ${to?.label || "Luogo"}`;
  const typeLabel = typeById.get(id(connection.connectionTypeDefinitionId))?.label || "";
  return typeLabel ? `${typeLabel} · ${route}` : route;
}

export function extendVenueMapRefinementMixin(base) {
  return {
    ...base,

    decorateMapRefinements() {
      base.decorateMapRefinements.call(this);
      this.decorateMapObjectLabels();
      this.decorateConnectionMetricComposer();
    },

    decorateMapObjectLabels() {
      const surface = this.querySelector(".map-canvas--authoring[data-map-surface]");
      if (!surface) return;
      const layout = this.data.layout || {};
      const definitions = this.physicalDefinitions?.() || {};
      const placeById = new Map((layout.places || []).map((place) => [id(place._id), place]));
      const typeById = new Map((definitions.connectionTypes || []).map((type) => [id(type.definitionId), type]));

      for (const node of surface.querySelectorAll("[data-map-place]")) {
        const place = placeById.get(id(node.dataset.mapPlace));
        if (!place) continue;
        const numericMarker = [...node.children].find((child) => child.tagName === "SPAN" && !child.classList.contains("map-object-label"));
        numericMarker?.remove();
        node.querySelector(":scope > .map-object-label")?.remove();
        node.removeAttribute("title");
        node.dataset.labelPlacement = labelPlacement(place.position);
        const label = document.createElement("span");
        label.className = "map-object-label map-place-label";
        label.textContent = place.label || "Luogo";
        label.setAttribute("aria-hidden", "true");
        node.append(label);
      }

      for (const existing of surface.querySelectorAll(":scope > .map-connection-label")) existing.remove();
      for (const connection of layout.connections || []) {
        const connectionId = id(connection._id);
        const hit = surface.querySelector(`[data-map-connection="${CSS.escape(connectionId)}"]`);
        if (!hit) continue;
        const midpoint = polylineMidpoint(connectionPoints(layout, connection));
        if (!midpoint) continue;
        const text = connectionDisplayLabel(connection, placeById, typeById);
        hit.setAttribute("aria-label", text);
        const label = document.createElement("span");
        label.className = "map-object-label map-connection-label";
        label.dataset.mapConnectionLabel = connectionId;
        label.dataset.labelPlacement = labelPlacement(midpoint);
        label.dataset.visible = id(this.selectedConnectionId) === connectionId ? "true" : "false";
        label.style.left = `${clamp(midpoint.x) * 100}%`;
        label.style.top = `${clamp(midpoint.y) * 100}%`;
        label.textContent = text;
        label.setAttribute("aria-hidden", "true");
        surface.append(label);
        const show = () => { label.dataset.visible = "true"; };
        const hide = () => {
          if (id(this.selectedConnectionId) !== connectionId && !hit.classList.contains("map-object-created")) label.dataset.visible = "false";
        };
        hit.onpointerenter = show;
        hit.onpointerleave = hide;
        hit.onfocus = show;
        hit.onblur = hide;
      }
    },

    decorateConnectionMetricComposer() {
      const form = this.querySelector("[data-connection-composer]");
      const action = this.pendingMapAction;
      if (!form || action?.type !== "connect" || !action.fromPlaceId || !action.toPlaceId) return;
      const metricMode = form.querySelector('select[name="metricMode"]');
      const manualInput = form.querySelector('input[name="distanceMeters"]');
      const manualDistance = manualInput?.closest("label");
      if (!metricMode || !manualInput || !manualDistance) return;

      let derivedDistance = form.querySelector("[data-derived-connection-distance]");
      if (!derivedDistance) {
        derivedDistance = document.createElement("label");
        derivedDistance.dataset.derivedConnectionDistance = "";
        derivedDistance.innerHTML = `<span>Distanza calibrata (m)</span><input type="text" readonly aria-readonly="true"><small>Calcolata dalla geometria sulla planimetria calibrata.</small>`;
        metricMode.closest("label")?.insertAdjacentElement("afterend", derivedDistance);
      }
      const derivedInput = derivedDistance.querySelector("input");
      const sync = () => {
        const derived = metricMode.value === "geometry_derived";
        manualDistance.hidden = derived;
        manualInput.disabled = derived;
        manualInput.required = !derived;
        derivedDistance.hidden = !derived;
        if (!derived || !derivedInput) return;
        const layout = this.data.layout || {};
        const places = layout.places || [];
        const from = places.find((entry) => id(entry._id) === id(action.fromPlaceId));
        const to = places.find((entry) => id(entry._id) === id(action.toPlaceId));
        const floor = from && to && sameFloor(from, to)
          ? (layout.floors || []).find((entry) => id(entry._id) === id(from.floorId))
          : null;
        const distance = geometryDistanceMeters(connectionDraftPoints(layout, action), floor);
        derivedInput.value = Number.isFinite(distance) ? Number(distance).toFixed(2) : "Non disponibile";
      };
      metricMode.onchange = sync;
      sync();
    },

    highlightCreatedMapObject(kind, entityId) {
      requestAnimationFrame(() => {
        const key = id(entityId);
        const element = kind === "connection"
          ? this.querySelector(`[data-map-connection="${CSS.escape(key)}"]`)
          : kind === "slot"
            ? this.querySelector(`[data-open-spatial-slot="${CSS.escape(key)}"]`)?.closest("article")
            : this.querySelector(`[data-map-place="${CSS.escape(key)}"]`);
        if (!element) return;
        element.classList.add("map-object-created");
        const line = kind === "connection" && element.previousElementSibling?.classList.contains("connection-line") ? element.previousElementSibling : null;
        line?.classList.add("map-object-created");
        const connectionLabel = kind === "connection" ? this.querySelector(`[data-map-connection-label="${CSS.escape(key)}"]`) : null;
        if (connectionLabel) connectionLabel.dataset.visible = "true";
        window.setTimeout(() => {
          element.classList.remove("map-object-created");
          line?.classList.remove("map-object-created");
          if (connectionLabel && id(this.selectedConnectionId) !== key) connectionLabel.dataset.visible = "false";
        }, 1400);
      });
    },

    onMapPointerDown(event) {
      if (this.mapPositionSavePending) return;
      venueMapAuthoringMixin.onMapPointerDown.call(this, event);
    },

    async onMapPointerUp(event) {
      const drag = this.draggingPlace;
      if (!drag || drag.pointerId !== event.pointerId) return;
      this.draggingPlace = null;
      drag.node.releasePointerCapture?.(event.pointerId);
      drag.node.classList.remove("dragging");
      if (!drag.moved) return;
      this.suppressNextMapClick = true;

      const layout = this.data?.layout;
      const place = (layout?.places || []).find((entry) => id(entry._id) === drag.placeId);
      if (!layout || !place) return;
      const previousPosition = { x: Number(place.position?.x), y: Number(place.position?.y) };
      const incidentConnections = (layout.connections || []).filter((entry) => [id(entry.fromPlaceId), id(entry.toPlaceId)].includes(drag.placeId));
      const snapshots = incidentConnections.map((connection) => ({
        connection,
        distanceMeters: connection.distanceMeters,
        geometry: connection.geometry?.points?.length ? connection.geometry.points.map((point) => ({ x: Number(point.x), y: Number(point.y) })) : null,
      }));
      const connectionGeometryUpdates = incidentConnections
        .filter((connection) => connection.geometry?.points?.length)
        .map((connection) => {
          const points = connection.geometry.points.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
          if (id(connection.fromPlaceId) === drag.placeId) points[0] = { ...drag.point };
          if (id(connection.toPlaceId) === drag.placeId) points[points.length - 1] = { ...drag.point };
          return { connectionId: id(connection._id), geometryPoints: points };
        });

      place.position = { ...drag.point };
      for (const update of connectionGeometryUpdates) {
        const connection = incidentConnections.find((entry) => id(entry._id) === id(update.connectionId));
        if (!connection) continue;
        connection.geometry = { points: update.geometryPoints.map((point) => ({ ...point })) };
        if (connection.metricMode === "geometry_derived") {
          const floor = (layout.floors || []).find((entry) => id(entry._id) === id(place.floorId));
          const distance = geometryDistanceMeters(update.geometryPoints, floor);
          if (Number.isFinite(distance)) connection.distanceMeters = distance;
        }
      }
      this.decorateMapObjectLabels();

      this.mapPositionSavePending = true;
      drag.node.dataset.saving = "true";
      try {
        const response = await managementRepository.moveVenuePlace(this.id, drag.placeId, { position: drag.point, connectionGeometryUpdates });
        if (response?.layout) this.data.layout = response.layout;
        if (response?.release && this.data.release) this.data.release = { ...this.data.release, ...response.release };
        this.decorateMapObjectLabels();
      } catch (error) {
        place.position = previousPosition;
        for (const snapshot of snapshots) {
          snapshot.connection.distanceMeters = snapshot.distanceMeters;
          snapshot.connection.geometry = snapshot.geometry ? { points: snapshot.geometry.map((point) => ({ ...point })) } : null;
        }
        this.error = error instanceof Error ? error.message : "Spostamento del luogo non riuscito";
        this.render();
      } finally {
        this.mapPositionSavePending = false;
        delete drag.node.dataset.saving;
      }
    },

    async handleMapAuthoringClick(event) {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return false;
      if (this.suppressNextMapClick && target.closest("[data-map-place]")) {
        this.suppressNextMapClick = false;
        return true;
      }
      const creatingPlace = this.pendingMapAction?.type === "create-place";
      const beforePlaces = creatingPlace ? ids(this.data.layout?.places, (entry) => entry._id) : null;
      const handled = await base.handleMapAuthoringClick.call(this, event);
      if (handled && beforePlaces) {
        const placeId = createdId(beforePlaces, this.data.layout?.places, (entry) => entry._id);
        if (placeId) {
          this.spatialEditor = null;
          this.selectedMapPlaceId = null;
          this.activeSpatialTab = "map";
          this.render();
          this.highlightCreatedMapObject("place", placeId);
        }
      }
      return handled;
    },

    async handleMapAuthoringSubmit(form, data) {
      const connectionComposer = form.matches("[data-connection-composer]");
      const beforeConnections = connectionComposer ? ids(this.data.layout?.connections, (entry) => entry._id) : null;
      const slotPlaceId = form.matches("[data-detail-create-slot]") ? form.dataset.detailCreateSlot : null;
      const beforeSlots = slotPlaceId ? ids(this.data.layout?.exhibitSlots, (entry) => entry.exhibitSlotId) : null;

      const handled = await base.handleMapAuthoringSubmit.call(this, form, data);
      if (!handled) return false;

      if (beforeConnections) {
        const connectionId = createdId(beforeConnections, this.data.layout?.connections, (entry) => entry._id);
        if (connectionId) {
          this.spatialEditor = null;
          this.selectedConnectionId = null;
          this.activeSpatialTab = "map";
          this.render();
          this.highlightCreatedMapObject("connection", connectionId);
        }
      }
      if (slotPlaceId && beforeSlots) {
        const slotId = createdId(beforeSlots, this.data.layout?.exhibitSlots, (entry) => entry.exhibitSlotId);
        if (slotId) {
          this.spatialEditor = { kind: "place", id: id(slotPlaceId), tab: "slots" };
          this.selectedExhibitSlotId = null;
          this.activeSpatialTab = "map";
          this.render();
          this.highlightCreatedMapObject("slot", slotId);
        }
      }
      return true;
    },
  };
}
